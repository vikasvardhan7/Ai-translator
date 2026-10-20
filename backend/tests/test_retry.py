import httpx
import pytest

from app.models.protocol import ErrorCode
from app.services.translation.base import TranslationFailed
from app.services.voice.base import VoiceFailed
from tests.test_gemini import Recorder, answer, error, translator
from tests.test_gemini_voice import audio, synthesizer

pytestmark = pytest.mark.anyio


def busy(delay: str | None = None) -> httpx.Response:
    details = [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}]
    return error(429, "RESOURCE_EXHAUSTED", details=details if delay else None)


async def translate(recorder: Recorder):
    return await translator(recorder).translate_speech(b"RIFFdata", "audio/wav", ["en", "te"])


@pytest.mark.parametrize(
    ("first", "waited"),
    [
        (busy("1s"), [1.0]),
        (busy("0.25s"), [0.25]),
        (busy(), [0.5]),
        (error(503, "UNAVAILABLE"), [0.5]),
        (httpx.ConnectError("offline"), [0.5]),
    ],
    ids=["busy-for-a-second", "busy-briefly", "busy", "server-problem", "offline"],
)
async def test_a_short_problem_is_tried_again(first, waited: list[float], waits) -> None:
    recorder = Recorder(first, answer())

    result = await translate(recorder)

    assert result.text == "మీరు ఎలా ఉన్నారు?"
    assert (len(recorder.requests), waits) == (2, waited)


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (busy("40s"), ErrorCode.QUOTA_EXCEEDED),
        (error(400, "INVALID_ARGUMENT"), ErrorCode.PROVIDER_UNAVAILABLE),
        (httpx.ReadTimeout("slow"), ErrorCode.PROVIDER_UNAVAILABLE),
    ],
    ids=["busy-for-long", "bad-request", "too-slow"],
)
async def test_a_long_or_lasting_problem_is_not_tried_again(response, code, waits) -> None:
    recorder = Recorder(response, answer())

    with pytest.raises(TranslationFailed) as failed:
        await translate(recorder)

    assert (failed.value.code, len(recorder.requests), waits) == (code, 1, [])


async def test_each_try_waits_longer_than_the_last(waits) -> None:
    recorder = Recorder(*[error(500, "INTERNAL")] * 3, answer())

    result = await translate(recorder)

    assert result.text == "మీరు ఎలా ఉన్నారు?"
    assert (len(recorder.requests), waits) == (4, [0.5, 1.0, 2.0])


async def test_a_problem_that_lasts_fails_after_three_more_tries(waits) -> None:
    recorder = Recorder(*[error(500, "INTERNAL")] * 4, answer())

    with pytest.raises(TranslationFailed):
        await translate(recorder)

    assert (len(recorder.requests), waits) == (4, [0.5, 1.0, 2.0])


async def test_waiting_stops_once_the_total_would_be_too_long(waits) -> None:
    recorder = Recorder(busy("7s"), busy("7s"), answer())

    with pytest.raises(TranslationFailed) as failed:
        await translate(recorder)

    assert (failed.value.code, len(recorder.requests), waits) == (
        ErrorCode.QUOTA_EXCEEDED,
        2,
        [7.0],
    )


async def test_a_busy_voice_is_tried_again(waits) -> None:
    pcm = b"\x01\x00" * 100
    recorder = Recorder(busy("1s"), audio(pcm, "audio/L16;codec=pcm;rate=24000"))

    result = await synthesizer(recorder).synthesize("Hello")

    assert result.startswith(b"RIFF")
    assert (len(recorder.requests), waits) == (2, [1.0])


async def test_a_voice_limit_that_lasts_is_reported(waits) -> None:
    with pytest.raises(VoiceFailed) as failed:
        await synthesizer(Recorder(busy("30s"))).synthesize("Hello")

    assert "limit" in failed.value.message
    assert waits == []
