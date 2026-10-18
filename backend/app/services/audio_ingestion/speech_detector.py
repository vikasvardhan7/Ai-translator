import math
import sys
import uuid
from array import array
from collections import deque

from app.services.audio_ingestion.segment import BYTES_PER_SECOND, SAMPLE_WIDTH, AudioSegment

WINDOW_MS = 100
WINDOW_BYTES = BYTES_PER_SECOND * WINDOW_MS // 1000
SPEECH_RMS_THRESHOLD = 200
PRE_ROLL_WINDOWS = 3
END_SILENCE_WINDOWS = 15
KEPT_SILENCE_WINDOWS = 3
MIN_SPEECH_WINDOWS = 3
MAX_SENTENCE_BYTES = 30 * BYTES_PER_SECOND
MAX_FRAME_BYTES = BYTES_PER_SECOND


class FrameRejected(Exception):
    pass


def is_speech(window: bytes) -> bool:
    samples = array("h")
    samples.frombytes(window)
    if sys.byteorder == "big":
        samples.byteswap()
    return math.sqrt(sum(s * s for s in samples) / len(samples)) >= SPEECH_RMS_THRESHOLD


class SpeechDetector:
    def __init__(self) -> None:
        self._carry = b""
        self._pre_roll: deque[bytes] = deque(maxlen=PRE_ROLL_WINDOWS)
        self._sentence: bytearray | None = None
        self._spoken_windows = 0
        self._silent_windows = 0
        self._continues = False

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
            if is_speech(self._carry):
                self._spoken_windows += 1
                self._silent_windows = 0
        self._carry = b""
        self._pre_roll.clear()
        return self._finish()

    def _listen(self, window: bytes) -> AudioSegment | None:
        speech = is_speech(window)
        if self._sentence is None:
            if not speech:
                self._pre_roll.append(window)
                return None
            self._sentence = bytearray(b"".join(self._pre_roll))
            self._pre_roll.clear()
        self._sentence.extend(window)
        if speech:
            self._spoken_windows += 1
            self._silent_windows = 0
        else:
            self._silent_windows += 1
        if self._silent_windows >= END_SILENCE_WINDOWS:
            return self._finish()
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
        if sentence is None or spoken < needed:
            return None
        trailing = max(0, silent - KEPT_SILENCE_WINDOWS) * WINDOW_BYTES
        pcm = bytes(sentence[: len(sentence) - trailing])
        return AudioSegment(str(uuid.uuid4()), pcm)
