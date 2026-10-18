from app.core.config import Settings
from app.services.translation.base import SpeechTranslator
from app.services.translation.gemini import GeminiSpeechTranslator


def build_speech_translator(settings: Settings) -> SpeechTranslator | None:
    key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
    if not key or not settings.gemini_model:
        return None
    return GeminiSpeechTranslator(
        api_key=key,
        model=settings.gemini_model,
        timeout_seconds=settings.speech_timeout_seconds,
    )
