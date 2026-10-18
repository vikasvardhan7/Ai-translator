from dataclasses import dataclass
from typing import Protocol

from app.models.protocol import ErrorCode


@dataclass(frozen=True)
class Translation:
    language: str
    text: str
    same_language: bool


@dataclass(frozen=True)
class SpeechTranslation:
    text: str
    language: str
    language_name: str
    translations: tuple[Translation, ...]

    def for_language(self, language: str) -> Translation:
        return next(t for t in self.translations if t.language == language)


class NothingRecognised(Exception):
    pass


class TranslationFailed(Exception):
    def __init__(self, code: ErrorCode, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class SpeechTranslator(Protocol):
    async def translate_speech(
        self, audio: bytes, mime_type: str, target_languages: list[str]
    ) -> SpeechTranslation: ...

    async def aclose(self) -> None: ...
