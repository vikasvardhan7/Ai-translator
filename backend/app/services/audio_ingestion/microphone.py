import math
import sys
from array import array
from dataclasses import dataclass, field

from app.models.protocol import ErrorCode
from app.services.audio_ingestion.segment import (
    BYTES_PER_SECOND,
    SAMPLE_RATE,
    SAMPLE_WIDTH,
    AudioSegment,
)

MIN_DURATION_MS = 300
MAX_DURATION_MS = 30_000
MIN_BYTES = MIN_DURATION_MS * BYTES_PER_SECOND // 1000
MAX_BYTES = MAX_DURATION_MS * BYTES_PER_SECOND // 1000
MAX_FRAME_BYTES = BYTES_PER_SECOND
SILENCE_WINDOW_SAMPLES = SAMPLE_RATE // 10
SILENCE_RMS_THRESHOLD = 200


class AudioRejected(Exception):
    def __init__(self, code: ErrorCode, message: str, utterance_id: str | None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.utterance_id = utterance_id


@dataclass
class _OpenUtterance:
    utterance_id: str
    speaker_id: str
    spoken_language: str | None
    pcm: bytearray = field(default_factory=bytearray)


def is_silent(pcm: bytes) -> bool:
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder == "big":
        samples.byteswap()
    for start in range(0, len(samples), SILENCE_WINDOW_SAMPLES):
        window = samples[start : start + SILENCE_WINDOW_SAMPLES]
        if math.sqrt(sum(s * s for s in window) / len(window)) >= SILENCE_RMS_THRESHOLD:
            return False
    return True


class MicrophoneInput:
    def __init__(self) -> None:
        self._open: _OpenUtterance | None = None
        self._dropped_id: str | None = None

    def start(self, utterance_id: str, speaker_id: str, spoken_language: str | None) -> str | None:
        replaced_id = self._open.utterance_id if self._open is not None else None
        self._dropped_id = None
        self._open = _OpenUtterance(utterance_id, speaker_id, spoken_language)
        return replaced_id

    def add(self, frame: bytes) -> None:
        if self._open is None:
            if self._dropped_id is not None:
                return
            raise AudioRejected(
                ErrorCode.NO_ACTIVE_UTTERANCE,
                "Audio was received without an open utterance.",
                None,
            )
        utterance_id = self._open.utterance_id
        if len(frame) % SAMPLE_WIDTH or len(frame) > MAX_FRAME_BYTES:
            self._drop()
            raise AudioRejected(
                ErrorCode.INVALID_MESSAGE,
                "Audio frames must be 16-bit PCM and at most one second long.",
                utterance_id,
            )
        self._open.pcm.extend(frame)
        if len(self._open.pcm) > MAX_BYTES:
            self._drop()
            raise AudioRejected(
                ErrorCode.AUDIO_TOO_LONG,
                f"Speech longer than {MAX_DURATION_MS // 1000} seconds was discarded.",
                utterance_id,
            )

    def finish(self, utterance_id: str) -> AudioSegment | None:
        if self._open is None or self._open.utterance_id != utterance_id:
            if self._dropped_id == utterance_id:
                self._dropped_id = None
                return None
            raise AudioRejected(
                ErrorCode.NO_ACTIVE_UTTERANCE,
                "There is no open utterance with this id.",
                utterance_id,
            )
        current, self._open = self._open, None
        pcm = bytes(current.pcm)
        if len(pcm) < MIN_BYTES or is_silent(pcm):
            raise AudioRejected(
                ErrorCode.AUDIO_TOO_SHORT,
                "No speech was heard. Hold the button a little longer and speak.",
                utterance_id,
            )
        return AudioSegment(current.utterance_id, current.speaker_id, current.spoken_language, pcm)

    def _drop(self) -> None:
        if self._open is not None:
            self._dropped_id = self._open.utterance_id
            self._open = None
