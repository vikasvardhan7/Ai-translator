import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.services.trainer.gemini import CoachAnswer
from app.services.translation.base import DetectedLanguage, SpeechTranslation, Translation
from app.services.voice.base import VoiceFailed, VoiceOption


@dataclass
class TranslatorCall:
    audio: bytes
    mime_type: str
    target_languages: list[str]
    context: tuple[str, ...] = ()
    speaker_language: str | None = None


@dataclass
class FakeTranslator:
    language: str = "te"
    text: str = "మీరు ఎలా ఉన్నారు?"
    translation: str = "How are you?"
    language_name: str = "Telugu"
    failure: Exception | None = None
    delays: list[float] = field(default_factory=list)
    transcripts: list[str] = field(default_factory=list)
    calls: list[TranslatorCall] = field(default_factory=list)
    closed: bool = False

    async def translate_speech(
        self,
        audio: bytes,
        mime_type: str,
        target_languages: list[str],
        *,
        context: Sequence[str] = (),
        speaker_language: str | None = None,
    ) -> SpeechTranslation:
        self.calls.append(
            TranslatorCall(audio, mime_type, target_languages, tuple(context), speaker_language)
        )
        if self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if self.failure:
            raise self.failure
        text = self.transcripts.pop(0) if self.transcripts else self.text
        translations = tuple(
            Translation(target, text, True)
            if target == self.language
            else Translation(target, f"{self.translation} [{target}]", False)
            for target in target_languages
        )
        return SpeechTranslation(text, self.language, self.language_name, translations)

    async def detect_language(self, audio: bytes, mime_type: str) -> DetectedLanguage:
        self.calls.append(TranslatorCall(audio, mime_type, []))
        if self.failure:
            raise self.failure
        return DetectedLanguage(self.language, self.language_name)

    async def aclose(self) -> None:
        self.closed = True


@dataclass
class FakeSynthesizer:
    audio: bytes = b"RIFF-voice"
    failure: Exception | None = None
    delays: list[float] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)
    requests: list[tuple[str, str | None]] = field(default_factory=list)
    voices: list[VoiceOption] = field(default_factory=list)
    voices_failure: Exception | None = None
    closed: bool = False

    async def synthesize(self, text: str, voice: str | None = None) -> bytes:
        self.texts.append(text)
        self.requests.append((text, voice))
        if self.delays:
            await asyncio.sleep(self.delays.pop(0))
        if self.failure:
            raise self.failure
        return self.audio

    async def list_voices(self) -> list[VoiceOption]:
        if self.voices_failure:
            raise self.voices_failure
        return self.voices

    async def aclose(self) -> None:
        self.closed = True


VOICE_LIMIT = VoiceFailed("The free voice limit was reached.")


@dataclass
class Letter:
    to: str
    subject: str
    text: str


@dataclass
class FakeMailer:
    letters: list[Letter] = field(default_factory=list)
    failure: Exception | None = None

    async def send(self, to: str, subject: str, text: str) -> None:
        if self.failure:
            raise self.failure
        self.letters.append(Letter(to, subject, text))


@dataclass
class FakeTrainer:
    workout: object = None
    diet: object = None
    food_items: list = field(default_factory=list)
    answer: str = "Great work today."
    logs: tuple = ()
    failure: Exception | None = None
    asked: list[tuple] = field(default_factory=list)

    async def workout_plan(self, profile, targets, wishes, current, day):
        self.asked.append(("workout", wishes, current, day))
        if self.failure:
            raise self.failure
        return self.workout

    async def diet_plan(self, profile, targets, wishes, current, day):
        self.asked.append(("diet", wishes, current, day))
        if self.failure:
            raise self.failure
        return self.diet

    async def foods(self, text, profile):
        self.asked.append(("foods", text))
        if self.failure:
            raise self.failure
        return self.food_items

    async def coach(self, context, messages, now):
        self.asked.append(("coach", context, [m.text for m in messages], now))
        if self.failure:
            raise self.failure
        return CoachAnswer(self.answer, self.logs)

    async def aclose(self) -> None:
        return None
