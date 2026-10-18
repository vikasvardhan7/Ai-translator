from dataclasses import dataclass

SAMPLE_RATE = 16_000
SAMPLE_WIDTH = 2
CHANNELS = 1
BYTES_PER_SECOND = SAMPLE_RATE * SAMPLE_WIDTH * CHANNELS


@dataclass(frozen=True)
class AudioSegment:
    utterance_id: str
    pcm: bytes

    @property
    def duration_ms(self) -> int:
        return len(self.pcm) * 1000 // BYTES_PER_SECOND
