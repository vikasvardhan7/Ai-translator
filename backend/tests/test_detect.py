import pytest

from app.models.protocol import ErrorCode
from app.services.audio_ingestion.wav import encode_wav
from app.services.translation.base import NothingRecognised, TranslationFailed
from tests.audio import tone
from tests.conftest import make_client
from tests.fakes import FakeTranslator

DETECT = "/api/languages/detect"
WAV_HEADERS = {"Content-Type": "audio/wav"}


def detect(translator, body: bytes):
    return make_client(translator=translator).post(DETECT, content=body, headers=WAV_HEADERS)


def test_the_spoken_language_is_returned() -> None:
    translator = FakeTranslator()
    recording = encode_wav(tone(2.0))

    response = detect(translator, recording)

    assert response.status_code == 200
    assert response.json() == {"language": "te", "language_name": "Telugu"}
    call = translator.calls[0]
    assert (call.audio, call.mime_type) == (recording, "audio/wav")


def test_a_ten_second_recording_is_accepted() -> None:
    assert detect(FakeTranslator(), encode_wav(tone(10.0))).status_code == 200


def test_a_longer_recording_is_refused() -> None:
    translator = FakeTranslator()

    response = detect(translator, encode_wav(tone(10.01)))

    assert response.status_code == 413
    assert response.json()["detail"] == (
        "The recording is longer than 10 seconds. Record a few words and send it again."
    )
    assert translator.calls == []


@pytest.mark.parametrize(
    "body",
    [b"", b"not audio at all", b"RIFF\x00\x00\x00\x00AVI LIST", b"ID3" + bytes(100)],
    ids=["empty", "text", "other-riff", "mp3"],
)
def test_a_body_that_is_not_wav_is_refused(body: bytes) -> None:
    translator = FakeTranslator()

    response = detect(translator, body)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "The recording must be a WAV file: 16-bit PCM, mono, 16 kHz."
    )
    assert translator.calls == []


@pytest.mark.parametrize(
    ("failure", "status", "detail"),
    [
        (NothingRecognised(), 422, "No speech was heard. Say a few words in your language."),
        (
            TranslationFailed(ErrorCode.QUOTA_EXCEEDED, "Limit reached.", retryable=True),
            429,
            "Limit reached.",
        ),
        (
            TranslationFailed(ErrorCode.PROVIDER_UNAVAILABLE, "Took too long.", retryable=True),
            503,
            "Took too long.",
        ),
        (
            TranslationFailed(
                ErrorCode.PROVIDER_UNAVAILABLE, "Check GEMINI_API_KEY.", retryable=False
            ),
            503,
            "Check GEMINI_API_KEY.",
        ),
    ],
    ids=["no-speech", "quota", "provider", "key"],
)
def test_detection_failures_become_clear_errors(failure, status: int, detail: str) -> None:
    response = detect(FakeTranslator(failure=failure), encode_wav(tone(1.0)))

    assert response.status_code == status
    assert response.json()["detail"] == detail


def test_missing_setup_gives_a_setup_message() -> None:
    response = detect(None, encode_wav(tone(1.0)))

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Language detection is not set up. Add GEMINI_API_KEY and GEMINI_MODEL to backend/.env."
    )
