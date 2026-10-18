import math
import random
import struct

from app.services.audio_ingestion.segment import SAMPLE_RATE


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
