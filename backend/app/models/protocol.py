from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.languages import invalid_language_message, language_code
from app.models.session import ParticipantId

UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


class ErrorCode(StrEnum):
    INVALID_MESSAGE = "invalid_message"
    UNKNOWN_SESSION = "unknown_session"
    NO_ACTIVE_UTTERANCE = "no_active_utterance"
    AUDIO_TOO_SHORT = "audio_too_short"
    AUDIO_TOO_LONG = "audio_too_long"
    UNSUPPORTED_LANGUAGE = "unsupported_language"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    QUOTA_EXCEEDED = "quota_exceeded"
    VOICE_UNAVAILABLE = "voice_unavailable"
    INTERNAL_ERROR = "internal_error"


class UtteranceStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["utterance.start"]
    utterance_id: str = Field(pattern=UUID_PATTERN)
    speaker_id: ParticipantId
    spoken_language: str | None = None

    @field_validator("spoken_language")
    @classmethod
    def language_must_be_a_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = language_code(value)
        if code is None:
            raise ValueError(invalid_language_message(value))
        return code


class UtteranceEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["utterance.end"]
    utterance_id: str = Field(pattern=UUID_PATTERN)
