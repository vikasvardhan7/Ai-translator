from app.core.config import Settings
from app.services.assistant.base import MeetingAssistant
from app.services.assistant.gemini import GeminiMeetingAssistant


def build_meeting_assistant(settings: Settings) -> MeetingAssistant | None:
    key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
    model = settings.gemini_assistant_model or settings.gemini_model
    if not key or not model:
        return None
    return GeminiMeetingAssistant(
        api_key=key, model=model, timeout_seconds=settings.speech_timeout_seconds
    )
