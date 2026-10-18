from dataclasses import dataclass
from typing import Protocol

from app.models.protocol import ErrorCode


@dataclass(frozen=True)
class SpeechTranslation:
    text: str
    language: str
    language_name: str
    translation: str
    translated: bool


class TranslationFailed(Exception):
    def __init__(self, code: ErrorCode, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class SpeechTranslator(Protocol):
    async def translate_speech(
        self,
        audio: bytes,
        mime_type: str,
        target_language: str,
        spoken_language: str | None = None,
    ) -> SpeechTranslation: ...

    async def aclose(self) -> None: ...
