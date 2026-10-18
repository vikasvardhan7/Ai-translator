import pytest

from app.services.audio_ingestion.segment import BYTES_PER_SECOND
from app.services.audio_ingestion.speech_detector import (
    MAX_SENTENCE_BYTES,
    FrameRejected,
    SpeechDetector,
    is_speech,
)
from tests.audio import frames, silence, tone


def hear(detector: SpeechDetector, pcm: bytes, frame_bytes: int = 3200) -> list:
    segments = []
    for frame in frames(pcm, frame_bytes):
        segments += detector.add(frame)
    return segments


def test_speech_is_told_apart_from_silence() -> None:
    assert is_speech(tone(0.1))
    assert not is_speech(silence(0.1))


def test_a_sentence_ends_after_a_pause() -> None:
    detector = SpeechDetector()

    segments = hear(detector, silence(1.0) + tone(2.0) + silence(2.0))

    assert len(segments) == 1
    assert segments[0].duration_ms == 2600


def test_silence_and_short_noise_are_ignored() -> None:
    detector = SpeechDetector()

    assert hear(detector, silence(3.0) + tone(0.2) + silence(2.0)) == []
    assert detector.flush() is None


def test_each_sentence_gets_its_own_id() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(1.0) + silence(2.0) + tone(1.0) + silence(2.0))

    assert len(segments) == 2
    assert segments[0].utterance_id != segments[1].utterance_id


def test_long_speech_is_split_at_thirty_seconds() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(31.0), frame_bytes=BYTES_PER_SECOND)

    assert [len(s.pcm) for s in segments] == [MAX_SENTENCE_BYTES]
    assert detector.flush().duration_ms == 1000


def test_flush_ends_the_sentence_in_progress() -> None:
    detector = SpeechDetector()
    hear(detector, tone(1.0), frame_bytes=1000)

    segment = detector.flush()

    assert segment is not None and segment.duration_ms == 1000
    assert detector.flush() is None


def test_frames_of_any_size_are_joined() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(1.0) + silence(2.0), frame_bytes=1234)

    assert len(segments) == 1


@pytest.mark.parametrize(
    "frame", [b"", b"\x00", b"\x00\x00" * (BYTES_PER_SECOND // 2 + 1)], ids=["empty", "odd", "big"]
)
def test_bad_frames_are_rejected(frame: bytes) -> None:
    with pytest.raises(FrameRejected):
        SpeechDetector().add(frame)


def test_speech_after_a_short_pause_is_kept_on_flush() -> None:
    detector = SpeechDetector()
    hear(detector, tone(1.0) + silence(0.5) + tone(0.05), frame_bytes=1600)

    segment = detector.flush()

    assert segment is not None and segment.duration_ms == 1550


def test_the_end_of_a_long_sentence_is_kept_after_the_split() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(30.2) + silence(2.0), frame_bytes=BYTES_PER_SECOND // 5)

    assert [s.duration_ms for s in segments] == [30_000, 500]


def test_silence_after_a_split_is_not_sent() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(30.0) + silence(2.0), frame_bytes=BYTES_PER_SECOND)

    assert [s.duration_ms for s in segments] == [30_000]
    assert detector.flush() is None


def test_the_next_sentence_keeps_the_moment_before_it_starts() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(1.0) + silence(2.0) + tone(1.0) + silence(2.0))

    assert [s.duration_ms for s in segments] == [1300, 1600]


def test_a_quick_reply_keeps_the_moment_before_it_starts() -> None:
    detector = SpeechDetector()

    segments = hear(detector, tone(1.0) + silence(1.5) + tone(1.0) + silence(2.0))

    assert [s.duration_ms for s in segments] == [1300, 1600]
