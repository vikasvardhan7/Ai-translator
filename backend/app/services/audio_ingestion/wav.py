import io
import wave

from app.services.audio_ingestion.segment import CHANNELS, SAMPLE_RATE, SAMPLE_WIDTH


def encode_wav(pcm: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(SAMPLE_WIDTH)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm)
    return buffer.getvalue()
