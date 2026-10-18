import wave

import pytest

from app.models.protocol import ErrorCode
from app.services.audio_ingestion.microphone import (
    AudioRejected,
    MicrophoneInput,
    is_silent,
)
from app.services.audio_ingestion.wav import write_wav
from tests.audio import frames, silence, tone

UID = "0f8fad5b-d9cb-469f-a165-70867728950e"


def speak(mic: MicrophoneInput, pcm: bytes, utterance_id: str = UID):
    mic.start(utterance_id, "A", None)
    for frame in frames(pcm):
        mic.add(frame)
    return mic.finish(utterance_id)


def code_of(excinfo: pytest.ExceptionInfo[AudioRejected]) -> ErrorCode:
    return excinfo.value.code


def test_finished_utterance_has_audio_and_duration() -> None:
    segment = speak(MicrophoneInput(), tone(2.0))

    assert segment.utterance_id == UID
    assert segment.speaker_id == "A"
    assert segment.duration_ms == 2000
    assert len(segment.pcm) == 64_000


def test_pinned_language_is_kept() -> None:
    mic = MicrophoneInput()
    mic.start(UID, "B", "te")
    mic.add(tone(1.0))

    assert mic.finish(UID).spoken_language == "te"


def test_too_short_is_rejected() -> None:
    with pytest.raises(AudioRejected) as excinfo:
        speak(MicrophoneInput(), tone(0.2))

    assert code_of(excinfo) == ErrorCode.AUDIO_TOO_SHORT


def test_silence_is_rejected() -> None:
    with pytest.raises(AudioRejected) as excinfo:
        speak(MicrophoneInput(), silence(2.0))

    assert code_of(excinfo) == ErrorCode.AUDIO_TOO_SHORT


def test_short_speech_inside_silence_is_accepted() -> None:
    segment = speak(MicrophoneInput(), silence(1.0) + tone(0.2) + silence(1.0))

    assert segment.duration_ms == 2200


def test_too_long_is_rejected_once_and_later_frames_are_dropped() -> None:
    mic = MicrophoneInput()
    mic.start(UID, "A", None)
    with pytest.raises(AudioRejected) as excinfo:
        for frame in frames(tone(31.0)):
            mic.add(frame)

    assert code_of(excinfo) == ErrorCode.AUDIO_TOO_LONG
    mic.add(tone(0.1))
    assert mic.finish(UID) is None


def test_audio_without_open_utterance_is_rejected() -> None:
    with pytest.raises(AudioRejected) as excinfo:
        MicrophoneInput().add(tone(0.1))

    assert code_of(excinfo) == ErrorCode.NO_ACTIVE_UTTERANCE


def test_new_start_replaces_an_unfinished_utterance() -> None:
    other = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    mic = MicrophoneInput()
    mic.start(UID, "A", None)
    mic.add(tone(1.0))

    assert mic.start(other, "B", None) == UID
    mic.add(tone(1.0))
    assert mic.finish(other).speaker_id == "B"


def test_first_start_replaces_nothing() -> None:
    assert MicrophoneInput().start(UID, "A", None) is None


def test_end_with_wrong_id_is_rejected() -> None:
    mic = MicrophoneInput()
    mic.start(UID, "A", None)
    mic.add(tone(1.0))

    with pytest.raises(AudioRejected) as excinfo:
        mic.finish("1b4e28ba-2fa1-11d2-883f-0016d3cca427")

    assert code_of(excinfo) == ErrorCode.NO_ACTIVE_UTTERANCE


@pytest.mark.parametrize(
    "frame",
    [
        pytest.param(b"\x00\x01\x02", id="odd-byte-count"),
        pytest.param(b"\x00" * 32_002, id="longer-than-one-second"),
    ],
)
def test_malformed_frames_are_rejected(frame: bytes) -> None:
    mic = MicrophoneInput()
    mic.start(UID, "A", None)

    with pytest.raises(AudioRejected) as excinfo:
        mic.add(frame)

    assert code_of(excinfo) == ErrorCode.INVALID_MESSAGE
    assert mic.finish(UID) is None


def test_new_utterance_can_start_after_a_rejected_one() -> None:
    mic = MicrophoneInput()
    with pytest.raises(AudioRejected):
        speak(mic, tone(0.1))

    other = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    assert speak(mic, tone(1.0), other).utterance_id == other


def test_is_silent() -> None:
    assert is_silent(silence(1.0))
    assert not is_silent(tone(1.0))


def test_wav_file_has_correct_format(tmp_path) -> None:
    segment = speak(MicrophoneInput(), tone(1.5))

    path = write_wav(segment, tmp_path / "debug")

    assert path.name == f"{UID}.wav"
    with wave.open(str(path), "rb") as wav_file:
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getframerate() == 16_000
        assert wav_file.getnframes() == 24_000
