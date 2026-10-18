from enum import StrEnum


class ErrorCode(StrEnum):
    INVALID_MESSAGE = "invalid_message"
    UNKNOWN_SESSION = "unknown_session"
    NOT_JOINED = "not_joined"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    QUOTA_EXCEEDED = "quota_exceeded"
    VOICE_UNAVAILABLE = "voice_unavailable"
    INTERNAL_ERROR = "internal_error"
