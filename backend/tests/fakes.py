import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field

import httpx

from app.services.trainer.gemini import CoachAnswer
from app.services.trainer.library import ExerciseLibrary
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
    actions: tuple = ()
    failure: Exception | None = None
    asked: list[tuple] = field(default_factory=list)
    library_seen: list = field(default_factory=list)

    async def workout_plan(self, profile, targets, wishes, current, day, library=()):
        self.asked.append(("workout", wishes, current, day))
        self.library_seen = list(library)
        if self.failure:
            raise self.failure
        return self.workout

    async def diet_plan(self, profile, targets, wishes, current, day):
        self.asked.append(("diet", wishes, current, day))
        if self.failure:
            raise self.failure
        return self.diet

    async def foods(self, text, profile, photo=None):
        self.asked.append(("foods", text, photo))
        if self.failure:
            raise self.failure
        return self.food_items

    async def coach(self, context, messages, now):
        self.asked.append(("coach", context, [m.text for m in messages], now))
        if self.failure:
            raise self.failure
        return CoachAnswer(self.answer, self.logs, self.actions)

    async def aclose(self) -> None:
        return None


LIBRARY_URL = "https://library.test/exercises.json"
IMAGES_URL = "https://library.test/images/"


def library_entry(
    exercise_id: str, name: str, equipment: str | None, primary: str, level: str = "beginner"
) -> dict:
    return {
        "id": exercise_id,
        "name": name,
        "force": "push",
        "level": level,
        "mechanic": "compound",
        "equipment": equipment,
        "primaryMuscles": [primary],
        "secondaryMuscles": ["glutes"],
        "instructions": ["Stand tall.", " Move with control. ", ""],
        "category": "strength",
        "images": [f"{exercise_id}/0.jpg", f"{exercise_id}/1.jpg"],
    }


LIBRARY = [
    library_entry("Goblet_Squat", "Goblet Squat", "kettlebells", "quadriceps"),
    library_entry("Leg_Press", "Leg Press", "machine", "quadriceps"),
    library_entry("Pushups", "Pushups", "body only", "chest"),
    library_entry("Dumbbell_Shoulder_Press", "Dumbbell Shoulder Press", "dumbbell", "shoulders"),
    library_entry("Barbell_Shoulder_Press", "Barbell Shoulder Press", "barbell", "shoulders"),
    library_entry("Plank", "Plank", None, "abdominals"),
    library_entry("Seated_Cable_Rows", "Seated Cable Rows", "cable", "middle back"),
    library_entry("Atlas_Stones", "Atlas Stones", "other", "lower back", "expert")
    | {"category": "strongman"},
    {"name": "Broken entry"},
]


@dataclass
class LibraryServer:
    entries: list = field(default_factory=lambda: list(LIBRARY))
    status: int = 200
    asked: int = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.asked += 1
        if self.status != 200:
            return httpx.Response(self.status)
        return httpx.Response(200, json=self.entries)


def fake_library(server: LibraryServer | None = None) -> ExerciseLibrary:
    client = httpx.AsyncClient(transport=httpx.MockTransport(server or LibraryServer()))
    return ExerciseLibrary(LIBRARY_URL, IMAGES_URL, http_client=client)
