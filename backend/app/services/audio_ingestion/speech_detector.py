import math
import sys
import uuid
from array import array
from collections import deque

from app.services.audio_ingestion.segment import BYTES_PER_SECOND, SAMPLE_WIDTH, AudioSegment

WINDOW_MS = 100
WINDOW_BYTES = BYTES_PER_SECOND * WINDOW_MS // 1000
SPEECH_RMS_THRESHOLD = 200
NOISE_MARGIN = 3.0
FLOOR_RISE = 0.05
FLOOR_CHECK_WINDOWS = 30
STEADY_RATIO = 0.6
PRE_ROLL_WINDOWS = 3
END_SILENCE_WINDOWS = 10
KEPT_SILENCE_WINDOWS = 3
MIN_SPEECH_WINDOWS = 3
MAX_SENTENCE_BYTES = 30 * BYTES_PER_SECOND
MAX_FRAME_BYTES = BYTES_PER_SECOND


class FrameRejected(Exception):
    pass


def loudness(window: bytes) -> float:
    samples = array("h")
    samples.frombytes(window)
    if sys.byteorder == "big":
        samples.byteswap()
    return math.sqrt(sum(s * s for s in samples) / len(samples))


def speech_threshold(noise_floor: float | None) -> float:
    return max(SPEECH_RMS_THRESHOLD, (noise_floor or 0.0) * NOISE_MARGIN)


def is_speech(window: bytes, noise_floor: float | None = None) -> bool:
    return loudness(window) >= speech_threshold(noise_floor)


class SpeechDetector:
    def __init__(self, speaker_id: str | None = None) -> None:
        self._speaker_id = speaker_id
        self._carry = b""
        self._pre_roll: deque[bytes] = deque(maxlen=PRE_ROLL_WINDOWS)
        self._sentence: bytearray | None = None
        self._spoken_windows = 0
        self._silent_windows = 0
        self._continues = False
        self._noise_floor: float | None = None
        self._levels: list[float] = []

    @property
    def in_sentence(self) -> bool:
        return self._sentence is not None

    def add(self, frame: bytes) -> list[AudioSegment]:
        if not frame or len(frame) % SAMPLE_WIDTH or len(frame) > MAX_FRAME_BYTES:
            raise FrameRejected
        data = self._carry + frame
        whole = len(data) - len(data) % WINDOW_BYTES
        self._carry = data[whole:]
        segments = []
        for start in range(0, whole, WINDOW_BYTES):
            if segment := self._listen(data[start : start + WINDOW_BYTES]):
                segments.append(segment)
        return segments

    def flush(self) -> AudioSegment | None:
        if self._sentence is not None and self._carry:
            self._sentence.extend(self._carry)
            if is_speech(self._carry, self._noise_floor):
                self._spoken_windows += 1
                self._silent_windows = 0
        self._carry = b""
        self._pre_roll.clear()
        return self._finish()

    def _hear_room(self, level: float) -> None:
        if self._noise_floor is None or level < self._noise_floor:
            self._noise_floor = level
        else:
            self._noise_floor += (level - self._noise_floor) * FLOOR_RISE

    def _check_steady_sound(self, level: float) -> None:
        self._levels.append(level)
        if len(self._levels) % FLOOR_CHECK_WINDOWS:
            return
        recent = self._levels[-FLOOR_CHECK_WINDOWS:]
        quietest = min(recent)
        if quietest >= max(recent) * STEADY_RATIO:
            self._noise_floor = max(self._noise_floor or 0.0, quietest)

    def _listen(self, window: bytes) -> AudioSegment | None:
        level = loudness(window)
        speech = level >= speech_threshold(self._noise_floor)
        if self._sentence is None:
            if not speech:
                self._hear_room(level)
                self._pre_roll.append(window)
                return None
            self._sentence = bytearray(b"".join(self._pre_roll))
            self._pre_roll.clear()
        self._check_steady_sound(level)
        self._sentence.extend(window)
        if speech:
            self._spoken_windows += 1
            self._silent_windows = 0
        else:
            self._silent_windows += 1
        if self._silent_windows >= END_SILENCE_WINDOWS:
            quiet = bytes(self._sentence[-PRE_ROLL_WINDOWS * WINDOW_BYTES :])
            segment = self._finish()
            for start in range(0, len(quiet), WINDOW_BYTES):
                self._pre_roll.append(quiet[start : start + WINDOW_BYTES])
            return segment
        if len(self._sentence) >= MAX_SENTENCE_BYTES:
            segment = self._finish()
            self._sentence = bytearray()
            self._continues = True
            return segment
        return None

    def _finish(self) -> AudioSegment | None:
        sentence, spoken, silent = self._sentence, self._spoken_windows, self._silent_windows
        needed = 1 if self._continues else MIN_SPEECH_WINDOWS
        self._sentence = None
        self._spoken_windows = 0
        self._silent_windows = 0
        self._continues = False
        self._levels = []
        if sentence is None or spoken < needed:
            return None
        trailing = max(0, silent - KEPT_SILENCE_WINDOWS) * WINDOW_BYTES
        pcm = bytes(sentence[: len(sentence) - trailing])
        return AudioSegment(str(uuid.uuid4()), pcm, self._speaker_id)
