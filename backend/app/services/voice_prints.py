from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
FRAME = 400
HOP = 160
FFT_SIZE = 512
BANDS = 40
LOWEST_HZ = 60.0
HIGHEST_HZ = 7600.0
PRE_EMPHASIS = 0.97
QUIET_PERCENTILE = 40
COEFFICIENTS = slice(1, 20)
MIN_SPEECH_FRAMES = 60
NEW_VOICE_DISTANCE = 5.0
MAX_WEIGHT = 20
REMEMBERED = 40


def _mel(hertz: np.ndarray) -> np.ndarray:
    return 2595 * np.log10(1 + hertz / 700)


def _hertz(mel: np.ndarray) -> np.ndarray:
    return 700 * (10 ** (mel / 2595) - 1)


def _filter_bank() -> np.ndarray:
    edges = _hertz(np.linspace(_mel(np.array(LOWEST_HZ)), _mel(np.array(HIGHEST_HZ)), BANDS + 2))
    bins = np.floor((FFT_SIZE + 1) * edges / SAMPLE_RATE).astype(int)
    bank = np.zeros((BANDS, FFT_SIZE // 2 + 1))
    for band in range(BANDS):
        low, middle, high = bins[band], bins[band + 1], bins[band + 2]
        bank[band, low:middle] = (np.arange(low, middle) - low) / max(middle - low, 1)
        bank[band, middle:high] = (high - np.arange(middle, high)) / max(high - middle, 1)
    return bank


FILTER_BANK = _filter_bank()
COSINES = np.cos(np.pi / BANDS * (np.arange(BANDS)[None, :] + 0.5) * np.arange(BANDS)[:, None])
WINDOW = np.hamming(FRAME)


def voice_print(pcm: bytes) -> np.ndarray | None:
    samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float64) / 32768
    if len(samples) < FRAME:
        return None
    emphasised = np.append(samples[0], samples[1:] - PRE_EMPHASIS * samples[:-1])
    count = 1 + (len(emphasised) - FRAME) // HOP
    index = np.arange(FRAME)[None, :] + HOP * np.arange(count)[:, None]
    power = np.abs(np.fft.rfft(emphasised[index] * WINDOW, FFT_SIZE)) ** 2
    log_mel = np.log(power @ FILTER_BANK.T + 1e-10)
    loudness = log_mel.mean(axis=1)
    speech = log_mel[loudness > np.percentile(loudness, QUIET_PERCENTILE)]
    if len(speech) < MIN_SPEECH_FRAMES:
        return None
    return (speech @ COSINES.T)[:, COEFFICIENTS].mean(axis=0)


def distance(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.linalg.norm(first - second) / np.sqrt(first.size))


@dataclass
class _Voice:
    centre: np.ndarray
    count: int

    def add(self, heard: np.ndarray) -> None:
        weight = min(self.count, MAX_WEIGHT)
        self.centre = (self.centre * weight + heard) / (weight + 1)
        self.count += 1

    def remove(self, heard: np.ndarray) -> None:
        weight = min(self.count, MAX_WEIGHT)
        self.centre = (self.centre * weight - heard) / (weight - 1)
        self.count -= 1


class VoiceBook:
    def __init__(self, labels: Sequence[str]) -> None:
        self.labels = tuple(labels)
        self._voices: dict[str, _Voice] = {}
        self._heard: OrderedDict[str, tuple[np.ndarray, str]] = OrderedDict()

    def match(self, utterance_id: str, heard: np.ndarray) -> str:
        nearest = min(
            self._voices,
            key=lambda label: distance(heard, self._voices[label].centre),
            default=None,
        )
        free = next((label for label in self.labels if label not in self._voices), None)
        if nearest is None or (
            free is not None and distance(heard, self._voices[nearest].centre) > NEW_VOICE_DISTANCE
        ):
            label = free or self.labels[0]
            self._voices[label] = _Voice(heard.copy(), 1)
        else:
            self._voices[nearest].add(heard)
            label = nearest
        self._remember(utterance_id, heard, label)
        return label

    def fix(self, utterance_id: str, label: str) -> bool:
        found = self._heard.get(utterance_id)
        if found is None or label not in self.labels:
            return False
        heard, current = found
        if current == label:
            return True
        voice = self._voices.get(current)
        if voice is not None:
            if voice.count <= 1:
                del self._voices[current]
            else:
                voice.remove(heard)
        if label in self._voices:
            self._voices[label].add(heard)
        else:
            self._voices[label] = _Voice(heard.copy(), 1)
        self._heard[utterance_id] = (heard, label)
        return True

    def _remember(self, utterance_id: str, heard: np.ndarray, label: str) -> None:
        self._heard[utterance_id] = (heard, label)
        while len(self._heard) > REMEMBERED:
            self._heard.popitem(last=False)
