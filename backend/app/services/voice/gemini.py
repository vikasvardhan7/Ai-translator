import logging
import re

import httpx
from google import genai
from google.genai import errors, types

from app.services.audio_ingestion.wav import encode_wav
from app.services.voice.base import VoiceFailed

logger = logging.getLogger(__name__)

HTTP_TOO_MANY_REQUESTS = 429
WAV_MIME_TYPES = ("audio/wav", "audio/x-wav", "audio/wave")
PCM_MIME_TYPES = ("audio/l16", "audio/pcm")
DEFAULT_PCM_RATE = 24_000


class GeminiSpeechSynthesizer:
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._model = model
        self._http_client = http_client or httpx.AsyncClient()
        options = types.HttpOptions(
            timeout=max(1, round(timeout_seconds * 1000)),
            httpx_async_client=self._http_client,
        )
        self._client = genai.Client(api_key=api_key, http_options=options)

    async def aclose(self) -> None:
        await self._http_client.aclose()

    async def synthesize(self, text: str) -> bytes:
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=text,
                config=types.GenerateContentConfig(response_modalities=["AUDIO"]),
            )
        except errors.APIError as exc:
            logger.warning("Voice service error %s %s", exc.code, exc.status)
            if exc.code == HTTP_TOO_MANY_REQUESTS:
                raise VoiceFailed("The free voice limit was reached.") from exc
            raise VoiceFailed("The voice could not be made for this sentence.") from exc
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("Voice service unreachable: %s", type(exc).__name__)
            raise VoiceFailed("The voice service could not be reached.") from exc
        return _wav_audio(response)


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
