from app.core.config import Settings
from app.services.voice.base import SpeechSynthesizer
from app.services.voice.gemini import GeminiSpeechSynthesizer


def build_speech_synthesizer(settings: Settings) -> SpeechSynthesizer | None:
    key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
    if not key or not settings.gemini_tts_model:
        return None
    return GeminiSpeechSynthesizer(
        api_key=key,
        model=settings.gemini_tts_model,
        timeout_seconds=settings.speech_timeout_seconds,
    )
