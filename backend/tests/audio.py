import math
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


def frames(pcm: bytes, frame_bytes: int = 3200) -> list[bytes]:
    return [pcm[i : i + frame_bytes] for i in range(0, len(pcm), frame_bytes)]
