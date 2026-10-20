import asyncio
import logging
import re
import time
from collections.abc import Iterable
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.models.trainer import Equipment, LibraryExercise

logger = logging.getLogger(__name__)

FRESH_SECONDS = 24 * 3600
RETRY_SECONDS = 300
FETCH_TIMEOUT_SECONDS = 20
GOOD_MATCH = 0.5
NO_EQUIPMENT = "body only"
UNUSED_WORDS = frozenset({"a", "an", "and", "the", "with", "on", "of", "to", "for", "in", "your"})
LEVELS = {"beginner": 0, "intermediate": 1, "expert": 2}
COMMON_EQUIPMENT = ("barbell", "dumbbell", NO_EQUIPMENT, "machine", "cable", "kettlebells")
NOT_FOR_PLANS = frozenset({"strongman"})
EQUIPMENT_FOR: dict[Equipment, frozenset[str] | None] = {
    "gym": None,
    "home_dumbbells": frozenset({NO_EQUIPMENT, "dumbbell"}),
    "bodyweight": frozenset({NO_EQUIPMENT}),
}
UNAVAILABLE = (
    "The exercise library could not be loaded right now. Check the internet connection and"
    " try again in a few minutes."
)


class LibraryUnavailable(Exception):
    pass


class RawExercise(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    equipment: str | None = None
    category: str = "strength"
    level: str = "beginner"
    force: str | None = None
    mechanic: str | None = None
    primaryMuscles: list[str] = Field(default_factory=list)
    secondaryMuscles: list[str] = Field(default_factory=list)
    instructions: list[str] = Field(default_factory=list)
    images: list[str] = Field(default_factory=list)


def words(name: str) -> frozenset[str]:
    joined = re.sub(r"(\w)-(\w)", r"\1\2", name.lower())
    found = re.findall(r"[a-z0-9]+", joined)
    return frozenset(
        word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word
        for word in found
        if word not in UNUSED_WORDS
    )


def likeness(first: frozenset[str], second: frozenset[str]) -> float:
    if not first or not second:
        return 0.0
    return len(first & second) / len(first | second)


def _exercise(raw: RawExercise, images_url: str) -> LibraryExercise:
    return LibraryExercise(
        id=raw.id,
        name=raw.name,
        equipment=raw.equipment or NO_EQUIPMENT,
        category=raw.category,
        level=raw.level,
        force=raw.force,
        mechanic=raw.mechanic,
        primary=raw.primaryMuscles,
        secondary=raw.secondaryMuscles,
        instructions=[step.strip() for step in raw.instructions if step.strip()],
        images=[images_url + quote(path.lstrip("/")) for path in raw.images],
    )


def _commonness(equipment: str) -> int:
    return (
        COMMON_EQUIPMENT.index(equipment)
        if equipment in COMMON_EQUIPMENT
        else len(COMMON_EQUIPMENT)
    )


def allowed(exercise: LibraryExercise, equipment: Equipment) -> bool:
    kinds = EQUIPMENT_FOR[equipment]
    return exercise.category not in NOT_FOR_PLANS and (kinds is None or exercise.equipment in kinds)


class ExerciseLibrary:
    def __init__(
        self, url: str, images_url: str, http_client: httpx.AsyncClient | None = None
    ) -> None:
        self.url = url
        self._images_url = images_url if images_url.endswith("/") else images_url + "/"
        self._http_client = http_client or httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS)
        self._items: dict[str, LibraryExercise] = {}
        self._words: dict[str, frozenset[str]] = {}
        self._loaded_at: float | None = None
        self._failed_at: float | None = None
        self._lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._http_client.aclose()

    async def exercises(self) -> list[LibraryExercise]:
        await self._fresh()
        if not self._items:
            raise LibraryUnavailable(UNAVAILABLE)
        return list(self._items.values())

    async def get(self, exercise_id: str) -> LibraryExercise | None:
        await self.exercises()
        return self._items.get(exercise_id)

    async def choices(self, equipment: Equipment) -> list[LibraryExercise]:
        return [item for item in await self.exercises() if allowed(item, equipment)]

    async def match(self, name: str, equipment: Equipment | None = None) -> LibraryExercise | None:
        items = await self.exercises()
        wanted = words(name)
        if not wanted:
            return None
        preferred = [item for item in items if equipment is None or allowed(item, equipment)]
        return self._best(wanted, preferred) or self._best(wanted, items)

    def _best(
        self, wanted: frozenset[str], items: Iterable[LibraryExercise]
    ) -> LibraryExercise | None:
        scored = [(likeness(wanted, self._words[item.id]), item) for item in items]
        good = [(score, item) for score, item in scored if score >= GOOD_MATCH]
        if not good:
            return None
        return min(
            good,
            key=lambda pair: (
                -pair[0],
                len(self._words[pair[1].id]),
                _commonness(pair[1].equipment),
                LEVELS.get(pair[1].level, 3),
                pair[1].name,
            ),
        )[1]

    async def _fresh(self) -> None:
        now = time.monotonic()
        if self._loaded_at is not None and now - self._loaded_at < FRESH_SECONDS:
            return
        if self._failed_at is not None and now - self._failed_at < RETRY_SECONDS:
            return
        async with self._lock:
            now = time.monotonic()
            if self._loaded_at is not None and now - self._loaded_at < FRESH_SECONDS:
                return
            try:
                self._take(await self._download())
                self._loaded_at = time.monotonic()
                self._failed_at = None
            except (httpx.HTTPError, ValueError) as exc:
                logger.warning("Exercise library not loaded: %s", type(exc).__name__)
                self._failed_at = time.monotonic()

    async def _download(self) -> list:
        response = await self._http_client.get(self.url)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, list):
            raise ValueError("The exercise library is not a list.")
        return data

    def _take(self, data: list) -> None:
        items: dict[str, LibraryExercise] = {}
        for entry in data:
            try:
                exercise = _exercise(RawExercise.model_validate(entry), self._images_url)
            except ValidationError:
                continue
            items[exercise.id] = exercise
        if not items:
            raise ValueError("The exercise library is empty.")
        self._items = items
        self._words = {item.id: words(item.name) for item in items.values()}
        logger.info("Exercise library loaded: %d exercises", len(items))
