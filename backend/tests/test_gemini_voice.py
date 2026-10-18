import base64
import io
import json
import logging
import wave

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.services.voice.base import VoiceFailed
from app.services.voice.factory import build_speech_synthesizer
from app.services.voice.gemini import GeminiSpeechSynthesizer
from tests.test_gemini import API_KEY, Recorder, error

pytestmark = pytest.mark.anyio


def audio(data: bytes, mime_type: str) -> httpx.Response:
    part = {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode()}}
    candidate = {"content": {"role": "model", "parts": [part]}, "finishReason": "STOP"}
    return httpx.Response(200, json={"candidates": [candidate]})


def synthesizer(recorder: Recorder, model: str = "voice-model") -> GeminiSpeechSynthesizer:
    client = httpx.AsyncClient(transport=httpx.MockTransport(recorder))
    return GeminiSpeechSynthesizer(API_KEY, model, timeout_seconds=5, http_client=client)


async def test_wav_audio_is_returned_and_the_request_asks_for_audio() -> None:
    recorder = Recorder(audio(b"RIFF....WAVE", "audio/wav"))

    result = await synthesizer(recorder, "v1").synthesize("నమస్కారం")

    body = json.loads(recorder.requests[0].content)
    assert result == b"RIFF....WAVE"
    assert recorder.requests[0].url.path.endswith("/models/v1:generateContent")
    assert body["contents"][0]["parts"][0]["text"] == "నమస్కారం"
    assert body["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert API_KEY not in str(recorder.requests[0].url)


async def test_raw_pcm_is_wrapped_as_wav_at_its_own_rate() -> None:
    pcm = b"\x01\x00" * 2400
    recorder = Recorder(audio(pcm, "audio/L16;codec=pcm;rate=24000"))

    result = await synthesizer(recorder).synthesize("Hello")

    with wave.open(io.BytesIO(result), "rb") as wav_file:
        assert wav_file.getframerate() == 24_000
        assert wav_file.readframes(wav_file.getnframes()) == pcm


@pytest.mark.parametrize(
    ("response", "message_part"),
    [
        (error(429, "RESOURCE_EXHAUSTED"), "limit"),
        (error(500, "INTERNAL"), "could not be made"),
        (error(404, "NOT_FOUND"), "could not be made"),
        (httpx.ConnectError("offline"), "reached"),
        (httpx.Response(200, json={"candidates": []}), "no audio"),
        (audio(b"text", "text/plain"), "no audio"),
    ],
    ids=["quota", "server", "model-missing", "offline", "empty", "not-audio"],
)
async def test_failures_become_clear_voice_errors(response, message_part, caplog) -> None:
    caplog.set_level(logging.DEBUG)

    with pytest.raises(VoiceFailed) as excinfo:
        await synthesizer(Recorder(response)).synthesize("Hello")

    assert message_part in excinfo.value.message
    assert API_KEY not in caplog.text


async def test_aclose_closes_the_http_client() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(Recorder()))
    voice = GeminiSpeechSynthesizer(API_KEY, "m", timeout_seconds=5, http_client=client)

    await voice.aclose()

    assert client.is_closed


def test_factory_needs_both_key_and_voice_model() -> None:
    key = SecretStr(API_KEY)

    assert build_speech_synthesizer(Settings(_env_file=None, gemini_tts_model="v")) is None
    assert build_speech_synthesizer(Settings(_env_file=None, gemini_api_key=key)) is None
    built = build_speech_synthesizer(
        Settings(_env_file=None, gemini_api_key=key, gemini_tts_model="v")
    )
    assert isinstance(built, GeminiSpeechSynthesizer)
