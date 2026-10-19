from app.core.config import Settings
from app.services.assistant.base import MeetingAssistant
from app.services.assistant.gemini import GeminiMeetingAssistant


def build_meeting_assistant(settings: Settings) -> MeetingAssistant | None:
    key = settings.gemini_api_key.get_secret_value() if settings.gemini_api_key else ""
    if not key or not settings.gemini_model:
        return None
    return GeminiMeetingAssistant(
        api_key=key,
        model=settings.gemini_model,
        timeout_seconds=settings.speech_timeout_seconds,
    )
