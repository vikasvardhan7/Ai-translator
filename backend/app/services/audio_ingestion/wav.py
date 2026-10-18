import wave
from pathlib import Path

from app.services.audio_ingestion.segment import CHANNELS, SAMPLE_RATE, SAMPLE_WIDTH, AudioSegment


def write_wav(segment: AudioSegment, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{segment.utterance_id}.wav"
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(SAMPLE_WIDTH)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(segment.pcm)
    return path
