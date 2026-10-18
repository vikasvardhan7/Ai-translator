import logging
import re
from dataclasses import fields
from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from app.services.audio_ingestion.wav import encode_wav
from app.services.voice.base import VoiceFailed, VoiceOption

logger = logging.getLogger(__name__)

HTTP_TOO_MANY_REQUESTS = 429
WAV_MIME_TYPES = ("audio/wav", "audio/x-wav", "audio/wave")
PCM_MIME_TYPES = ("audio/l16", "audio/pcm")
DEFAULT_PCM_RATE = 24_000
VOICES_URL = "https://generativelanguage.googleapis.com/v1beta/voices"
VOICES_PAGE_SIZE = 1000
VOICE_LIMIT_REACHED = "The free voice limit was reached."
VOICE_LIST_FAILED = "The voice list could not be loaded."


class GeminiSpeechSynthesizer:
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._http_client = http_client or httpx.AsyncClient()
        options = types.HttpOptions(
            timeout=max(1, round(timeout_seconds * 1000)),
            httpx_async_client=self._http_client,
        )
        self._client = genai.Client(api_key=api_key, http_options=options)

    async def aclose(self) -> None:
        await self._http_client.aclose()

    async def synthesize(self, text: str, voice: str | None = None) -> bytes:
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"], speech_config=_speech_config(voice)
                ),
            )
        except errors.APIError as exc:
            logger.warning("Voice service error %s %s", exc.code, exc.status)
            if exc.code == HTTP_TOO_MANY_REQUESTS:
                raise VoiceFailed(VOICE_LIMIT_REACHED) from exc
            raise VoiceFailed("The voice could not be made for this sentence.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Voice service unreachable: %s", type(exc).__name__)
            raise VoiceFailed("The voice service could not be reached.") from exc
        return _wav_audio(response)

    async def list_voices(self) -> list[VoiceOption]:
        voices: list[VoiceOption] = []
        seen_tokens: set[str] = set()
        page_token = ""
        while True:
            page = await self._voice_page(page_token)
            listed = page.get("voices")
            voices.extend(_voice_options(listed if isinstance(listed, list) else []))
            page_token = _text(page, "next_page_token")
            if not page_token or page_token in seen_tokens:
                return voices
            seen_tokens.add(page_token)

    async def _voice_page(self, page_token: str) -> dict[str, Any]:
        params: dict[str, str | int] = {"type": "prebuilt", "page_size": VOICES_PAGE_SIZE}
        if page_token:
            params["page_token"] = page_token
        try:
            response = await self._http_client.get(
                VOICES_URL,
                params=params,
                headers={"x-goog-api-key": self._api_key},
                timeout=self._timeout_seconds,
            )
        except httpx.HTTPError as exc:
            logger.warning("Voice list unreachable: %s", type(exc).__name__)
            raise VoiceFailed(VOICE_LIST_FAILED) from exc
        if response.status_code == HTTP_TOO_MANY_REQUESTS:
            logger.warning("Voice list error %s", response.status_code)
            raise VoiceFailed(VOICE_LIMIT_REACHED)
        try:
            page = response.json() if response.is_success else None
        except ValueError:
            page = None
        if not isinstance(page, dict):
            logger.warning("Voice list error %s", response.status_code)
            raise VoiceFailed(VOICE_LIST_FAILED)
        return page


def _speech_config(voice: str | None) -> types.SpeechConfig | None:
    if voice is None:
        return None
    return types.SpeechConfig(
        voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)
        )
    )


def _camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(part.title() for part in rest)


def _text(item: dict[str, Any], name: str) -> str:
    value = item.get(name, item.get(_camel(name)))
    return value if isinstance(value, str) else ""


def _voice_options(listed: list[Any]) -> list[VoiceOption]:
    names = [field.name for field in fields(VoiceOption)]
    options = (
        VoiceOption(**{name: _text(item, name) for name in names})
        for item in listed
        if isinstance(item, dict)
    )
    return [option for option in options if option.id]


def _wav_audio(response: types.GenerateContentResponse) -> bytes:
    content = response.candidates[0].content if response.candidates else None
    blobs = [
        part.inline_data
        for part in ((content.parts or []) if content else [])
        if part.inline_data is not None and part.inline_data.data
    ]
    for blob in blobs:
        if (blob.mime_type or "").lower().startswith(WAV_MIME_TYPES):
            return blob.data
    pcm = [blob for blob in blobs if (blob.mime_type or "").lower().startswith(PCM_MIME_TYPES)]
    if not pcm:
        raise VoiceFailed("The voice service returned no audio.")
    rate = re.search(r"rate=(\d+)", (pcm[0].mime_type or "").lower())
    sample_rate = int(rate.group(1)) if rate else DEFAULT_PCM_RATE
    if sample_rate <= 0:
        raise VoiceFailed("The voice service returned unreadable audio.")
    return encode_wav(b"".join(blob.data for blob in pcm), sample_rate)
