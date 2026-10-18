import asyncio
from dataclasses import dataclass, field

from app.services.translation.base import SpeechTranslation, Translation
from app.services.voice.base import VoiceFailed


@dataclass
class TranslatorCall:
    audio: bytes
    mime_type: str
    target_languages: list[str]


@dataclass
class FakeTranslator:
    language: str = "te"
    text: str = "మీరు ఎలా ఉన్నారు?"
    translation: str = "How are you?"
    language_name: str = "Telugu"
    failure: Exception | None = None
    delays: list[float] = field(default_factory=list)
    calls: list[TranslatorCall] = field(default_factory=list)
    closed: bool = False

    async def translate_speech(
        self, audio: bytes, mime_type: str, target_languages: list[str]
    ) -> SpeechTranslation:
        self.calls.append(TranslatorCall(audio, mime_type, target_languages))
        if self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if self.failure:
            raise self.failure
        translations = tuple(
            Translation(target, self.text, True)
            if target == self.language
            else Translation(target, f"{self.translation} [{target}]", False)
            for target in target_languages
        )
        return SpeechTranslation(self.text, self.language, self.language_name, translations)

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class FakeSynthesizer:
    audio: bytes = b"RIFF-voice"
    failure: Exception | None = None
    delays: list[float] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    closed: bool = False

    async def synthesize(self, text: str) -> bytes:
        self.texts.append(text)
        if self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if self.failure:
            raise self.failure
        return self.audio

    async def aclose(self) -> None:
        self.closed = True


VOICE_LIMIT = VoiceFailed("The free voice limit was reached.")
