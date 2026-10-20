import math
import random
import struct

import numpy as np

from app.services.audio_ingestion.segment import SAMPLE_RATE

DEEP = (110.0, (700.0, 1150.0, 2500.0))
BRIGHT = (220.0, (380.0, 2250.0, 3000.0))
WARM = (150.0, (550.0, 1700.0, 2600.0))


def tone(seconds: float, frequency: float = 440.0, amplitude: int = 8000) -> bytes:
    count = int(SAMPLE_RATE * seconds)
    samples = (
        int(amplitude * math.sin(2 * math.pi * frequency * i / SAMPLE_RATE)) for i in range(count)
    )
    return struct.pack(f"<{count}h", *samples)


def silence(seconds: float) -> bytes:
    return b"\x00\x00" * int(SAMPLE_RATE * seconds)


def talk(seconds: float) -> bytes:
    second = tone(0.9) + silence(0.1)
    whole = second * math.ceil(seconds)
    return whole[: int(SAMPLE_RATE * seconds) * 2]


def varying(seconds: float, quiet: int, loud: int, syllable: float = 0.25) -> bytes:
    count = int(SAMPLE_RATE * seconds)
    span = (loud - quiet) / 2
    samples = (
        int(
            (quiet + span + span * math.sin(2 * math.pi * i / (SAMPLE_RATE * syllable)))
            * math.sqrt(2)
            * math.sin(2 * math.pi * 220 * i / SAMPLE_RATE)
        )
        for i in range(count)
    )
    return struct.pack(f"<{count}h", *samples)


def noise(seconds: float, level: float) -> bytes:
    chance = random.Random(7)
    count = int(SAMPLE_RATE * seconds)
    samples = (round(chance.gauss(0, level)) for _ in range(count))
    return struct.pack(f"<{count}h", *samples)


def mix(first: bytes, second: bytes) -> bytes:
    count = min(len(first), len(second)) // 2
    a = struct.unpack(f"<{count}h", first[: count * 2])
    b = struct.unpack(f"<{count}h", second[: count * 2])
    return struct.pack(
        f"<{count}h", *(max(-32768, min(32767, x + y)) for x, y in zip(a, b, strict=True))
    )


def frames(pcm: bytes, frame_bytes: int = 3200) -> list[bytes]:
    return [pcm[i : i + frame_bytes] for i in range(0, len(pcm), frame_bytes)]


def voice(seconds: float, sound: tuple[float, tuple[float, ...]], seed: int = 0) -> bytes:
    pitch, formants = sound
    chance = np.random.default_rng(seed)
    times = np.arange(int(SAMPLE_RATE * seconds)) / SAMPLE_RATE
    wobble = 1 + 0.05 * np.sin(2 * np.pi * 0.7 * times)
    phase = 2 * np.pi * np.cumsum(pitch * (1 + 0.01 * chance.standard_normal()) * wobble)
    phase /= SAMPLE_RATE
    signal = np.zeros_like(times)
    for harmonic in range(1, int(4000 / pitch)):
        frequency = harmonic * pitch
        gain = sum(np.exp(-((frequency - f) ** 2) / (2 * 90.0**2)) for f in formants) + 0.02
        signal += gain * np.sin(harmonic * phase) / np.sqrt(harmonic)
    signal *= 0.55 + 0.45 * np.sin(2 * np.pi * (3.5 + chance.random()) * times) ** 2
    signal += 0.002 * chance.standard_normal(len(times))
    signal *= 0.4 / np.max(np.abs(signal))
    return (signal * 32767).astype("<i2").tobytes()
