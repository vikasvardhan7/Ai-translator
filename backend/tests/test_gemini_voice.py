import base64
import io
import json
import logging
import wave

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.services.voice.base import VoiceFailed, VoiceOption
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


async def test_audio_in_several_parts_is_joined() -> None:
    first, second = b"\x01\x00" * 100, b"\x02\x00" * 100
    parts = [
        {"inlineData": {"mimeType": "audio/L16;rate=24000", "data": base64.b64encode(d).decode()}}
        for d in (first, second)
    ]
    candidate = {"content": {"role": "model", "parts": parts}, "finishReason": "STOP"}

    result = await synthesizer(
        Recorder(httpx.Response(200, json={"candidates": [candidate]}))
    ).synthesize("Hi")

    with wave.open(io.BytesIO(result), "rb") as wav_file:
        assert wav_file.readframes(wav_file.getnframes()) == first + second


async def test_audio_with_an_impossible_rate_is_refused() -> None:
    with pytest.raises(VoiceFailed):
        await synthesizer(Recorder(audio(b"\x01\x00" * 10, "audio/L16;rate=0"))).synthesize("Hi")


async def test_a_chosen_voice_is_asked_for_by_name() -> None:
    recorder = Recorder(audio(b"RIFF....WAVE", "audio/wav"), audio(b"RIFF....WAVE", "audio/wav"))
    voice = synthesizer(recorder)

    await voice.synthesize("Hello", "Puck")
    await voice.synthesize("Hello")

    chosen, automatic = (json.loads(r.content)["generationConfig"] for r in recorder.requests)
    assert chosen["speechConfig"] == {
        "voice_config": {"prebuilt_voice_config": {"voice_name": "Puck"}}
    }
    assert "speechConfig" not in automatic


def voices_page(voices: list, next_page_token: str = "") -> httpx.Response:
    return httpx.Response(200, json={"voices": voices, "next_page_token": next_page_token})


PUCK = {
    "id": "Puck",
    "display_name": "Puck",
    "description": "Upbeat",
    "gender": "male",
    "language_code": "en-US",
    "pitch": "medium",
    "accent": "American",
}


async def test_every_page_of_prebuilt_voices_is_listed() -> None:
    recorder = Recorder(
        voices_page([PUCK], "page-2"),
        voices_page([{"id": "Kore", "description": "Firm"}, {"display_name": "No id"}, "odd"]),
    )

    voices = await synthesizer(recorder).list_voices()

    first, second = recorder.requests
    assert [v.id for v in voices] == ["Puck", "Kore"]
    assert voices[0] == VoiceOption(**PUCK)
    assert voices[1] == VoiceOption("Kore", "", "Firm", "", "", "", "")
    assert str(first.url).startswith("https://generativelanguage.googleapis.com/v1beta/voices?")
    assert first.headers["x-goog-api-key"] == API_KEY
    assert API_KEY not in str(first.url)
    assert dict(first.url.params) == {"type": "prebuilt", "page_size": "1000"}
    assert dict(second.url.params) == {
        "type": "prebuilt",
        "page_size": "1000",
        "page_token": "page-2",
    }


async def test_camel_case_voice_fields_are_read_too() -> None:
    page = {"voices": [{"id": "Kore", "displayName": "Kore", "languageCode": "en-US"}]}
    first = httpx.Response(200, json={**page, "nextPageToken": "next"})
    recorder = Recorder(first, voices_page([]))

    voices = await synthesizer(recorder).list_voices()

    assert voices == [VoiceOption("Kore", "Kore", "", "", "en-US", "", "")]
    assert len(recorder.requests) == 2


async def test_a_repeated_page_token_ends_the_list() -> None:
    recorder = Recorder(voices_page([PUCK], "same"), voices_page([], "same"))

    voices = await synthesizer(recorder).list_voices()

    assert [v.id for v in voices] == ["Puck"]
    assert len(recorder.requests) == 2


@pytest.mark.parametrize(
    ("response", "message"),
    [
        (error(429, "RESOURCE_EXHAUSTED"), "The free voice limit was reached."),
        (error(500, "INTERNAL"), "The voice list could not be loaded."),
        (error(403, "PERMISSION_DENIED"), "The voice list could not be loaded."),
        (httpx.ConnectError("offline"), "The voice list could not be loaded."),
        (httpx.Response(200, text="not json"), "The voice list could not be loaded."),
        (httpx.Response(200, json=["not", "an", "object"]), "The voice list could not be loaded."),
    ],
    ids=["quota", "server", "forbidden", "offline", "not-json", "not-an-object"],
)
async def test_voice_list_failures_become_clear_errors(response, message, caplog) -> None:
    caplog.set_level(logging.DEBUG)

    with pytest.raises(VoiceFailed) as excinfo:
        await synthesizer(Recorder(response)).list_voices()

    assert excinfo.value.message == message
    assert API_KEY not in caplog.text


async def test_a_failure_on_a_later_page_fails_the_whole_list() -> None:
    recorder = Recorder(voices_page([PUCK], "page-2"), error(429, "RESOURCE_EXHAUSTED"))

    with pytest.raises(VoiceFailed) as excinfo:
        await synthesizer(recorder).list_voices()

    assert "limit" in excinfo.value.message
