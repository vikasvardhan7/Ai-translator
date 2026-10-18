import asyncio
from dataclasses import dataclass, field

from app.services.translation.base import SpeechTranslation, TranslationFailed


@dataclass
class TranslatorCall:
    audio: bytes
    mime_type: str
    target_language: str
    spoken_language: str | None


@dataclass
class FakeTranslator:
    language: str = "te"
    text: str = "మీరు ఎలా ఉన్నారు?"
    translation: str = "How are you?"
    language_name: str = "Telugu"
    failure: TranslationFailed | None = None
    delays: list[float] = field(default_factory=list)
    calls: list[TranslatorCall] = field(default_factory=list)
    closed: bool = False

    async def translate_speech(
        self,
        audio: bytes,
        mime_type: str,
        target_language: str,
        spoken_language: str | None = None,
    ) -> SpeechTranslation:
        self.calls.append(TranslatorCall(audio, mime_type, target_language, spoken_language))
        if self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if self.failure:
            raise self.failure
        translated = self.language != target_language
        translation = self.translation if translated else self.text
        return SpeechTranslation(
            self.text, self.language, self.language_name, translation, translated
        )

    async def aclose(self) -> None:
        self.closed = True
