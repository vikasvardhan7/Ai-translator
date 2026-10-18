from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.languages import is_supported
from app.models.session import ParticipantId

FILENAME_SAFE_UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class ErrorCode(StrEnum):
    INVALID_MESSAGE = "invalid_message"
    UNKNOWN_SESSION = "unknown_session"
    NO_ACTIVE_UTTERANCE = "no_active_utterance"
    AUDIO_TOO_SHORT = "audio_too_short"
    AUDIO_TOO_LONG = "audio_too_long"
    INTERNAL_ERROR = "internal_error"


class UtteranceStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["utterance.start"]
    utterance_id: str = Field(pattern=FILENAME_SAFE_UUID_PATTERN)
    speaker_id: ParticipantId
    spoken_language: str | None = None

    @field_validator("spoken_language")
    @classmethod
    def language_must_be_supported(cls, code: str | None) -> str | None:
        if code is not None and not is_supported(code):
            raise ValueError(f"'{code}' is not a supported language code.")
        return code


class UtteranceEnd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["utterance.end"]
    utterance_id: str = Field(pattern=FILENAME_SAFE_UUID_PATTERN)
