from collections.abc import Callable
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

Goal = Literal["lose_fat", "build_muscle", "get_fit", "get_stronger", "endurance"]
Level = Literal["beginner", "intermediate", "advanced"]
Sex = Literal["male", "female"]
Activity = Literal["sitting", "light", "moderate", "very_active"]
Equipment = Literal["gym", "home_dumbbells", "bodyweight"]
Diet = Literal["vegetarian", "eggetarian", "non_vegetarian", "vegan"]
Weekday = Literal["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
PlanKind = Literal["workout", "diet"]
PhotoKind = Literal["meal", "body"]
Page = Literal["today", "workouts", "diet", "progress", "exercises", "profile"]
PHOTO_ID = r"^[0-9a-f]{32}$"
WEEKDAYS: tuple[Weekday, ...] = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _clipped(limit: int) -> Callable[[Any], Any]:
    return lambda value: " ".join(value.split())[:limit] if isinstance(value, str) else value


def _clamped(lowest: float, highest: float, *, whole: bool) -> Callable[[Any], Any]:
    def clamp(value: Any) -> Any:
        if isinstance(value, bool) or not isinstance(value, int | float):
            return value
        kept = min(max(value, lowest), highest)
        return round(kept) if whole else kept

    return clamp


def limited_text(limit: int) -> Any:
    return Annotated[str, BeforeValidator(_clipped(limit))]


def bounded_int(lowest: int, highest: int) -> Any:
    return Annotated[int, BeforeValidator(_clamped(lowest, highest, whole=True))]


def bounded_float(lowest: float, highest: float) -> Any:
    return Annotated[float, BeforeValidator(_clamped(lowest, highest, whole=False))]


class Profile(Strict):
    name: str = Field(min_length=1, max_length=40)
    age: int = Field(ge=14, le=90)
    sex: Sex
    height_cm: float = Field(ge=120, le=230)
    weight_kg: float = Field(ge=30, le=300)
    target_weight_kg: float | None = Field(default=None, ge=30, le=300)
    goal: Goal
    level: Level
    activity: Activity
    days_per_week: int = Field(ge=1, le=7)
    minutes_per_session: int = Field(ge=15, le=180)
    equipment: Equipment
    diet: Diet
    cuisine: str = Field(default="", max_length=60)
    meals_per_day: int = Field(default=4, ge=2, le=6)
    allergies: str = Field(default="", max_length=200)
    health_notes: str = Field(default="", max_length=300)


class Targets(BaseModel):
    calories: int
    protein_g: int
    carbs_g: int
    fat_g: int
    water_ml: int
    resting_calories: int
    daily_burn: int
    explanation: str


class Exercise(Strict):
    name: limited_text(80) = Field(min_length=1)
    sets: bounded_int(1, 10)
    reps: limited_text(20) = Field(min_length=1)
    rest_seconds: bounded_int(0, 600)
    how: limited_text(200) = ""
    library_id: limited_text(120) = ""


class WorkoutDay(Strict):
    day: Weekday
    focus: limited_text(60) = Field(min_length=1)
    rest: bool
    warmup: limited_text(200) = ""
    exercises: list[Exercise] = Field(default_factory=list, max_length=15)
    cooldown: limited_text(200) = ""


class FoodItem(Strict):
    food: limited_text(80) = Field(min_length=1)
    amount: limited_text(40) = ""
    calories: bounded_int(0, 3000)
    protein_g: bounded_float(0, 300)
    carbs_g: bounded_float(0, 500)
    fat_g: bounded_float(0, 300)


class Meal(Strict):
    name: limited_text(40) = Field(min_length=1)
    time: limited_text(10) = ""
    items: list[FoodItem] = Field(default_factory=list, max_length=12)


class DietDay(Strict):
    day: Weekday
    meals: list[Meal] = Field(default_factory=list, max_length=8)


def _one_per_weekday[T: (WorkoutDay, DietDay)](days: list[T]) -> list[T]:
    if sorted(day.day for day in days) != sorted(WEEKDAYS):
        raise ValueError("A plan needs exactly one entry for each day of the week.")
    return sorted(days, key=lambda day: WEEKDAYS.index(day.day))


class WorkoutPlan(Strict):
    summary: limited_text(600) = ""
    days: list[WorkoutDay]

    @field_validator("days")
    @classmethod
    def every_weekday(cls, days: list[WorkoutDay]) -> list[WorkoutDay]:
        return _one_per_weekday(days)


class DietPlan(Strict):
    summary: limited_text(600) = ""
    days: list[DietDay]

    @field_validator("days")
    @classmethod
    def every_weekday(cls, days: list[DietDay]) -> list[DietDay]:
        return _one_per_weekday(days)


class ExerciseDone(Strict):
    kind: Literal["exercise"]
    name: str = Field(min_length=1, max_length=80)
    sets: int = Field(ge=1, le=20)
    reps: int = Field(default=0, ge=0, le=500)
    weight_kg: float | None = Field(default=None, ge=0, le=500)
    minutes: int | None = Field(default=None, ge=0, le=600)


class MealEaten(Strict):
    kind: Literal["meal"]
    meal: str = Field(min_length=1, max_length=40)
    food: str = Field(min_length=1, max_length=200)
    calories: int = Field(ge=0, le=5000)
    protein_g: float = Field(default=0, ge=0, le=500)
    carbs_g: float = Field(default=0, ge=0, le=800)
    fat_g: float = Field(default=0, ge=0, le=500)
    photo_id: str | None = Field(default=None, pattern=PHOTO_ID)


class WaterDrunk(Strict):
    kind: Literal["water"]
    ml: int = Field(ge=1, le=5000)


class WeightTaken(Strict):
    kind: Literal["weight"]
    kg: float = Field(ge=30, le=300)


class SleepHad(Strict):
    kind: Literal["sleep"]
    hours: float = Field(ge=0, le=24)


class StepsWalked(Strict):
    kind: Literal["steps"]
    count: int = Field(ge=0, le=100_000)


class NoteWritten(Strict):
    kind: Literal["note"]
    text: str = Field(min_length=1, max_length=500)


EntryData = Annotated[
    ExerciseDone | MealEaten | WaterDrunk | WeightTaken | SleepHad | StepsWalked | NoteWritten,
    Field(discriminator="kind"),
]


class EntryIn(Strict):
    data: EntryData


class EntryOut(BaseModel):
    id: str
    day: date
    data: EntryData
    created_at: datetime


class DaySummary(BaseModel):
    day: date
    calories: int
    protein_g: float
    carbs_g: float
    fat_g: float
    water_ml: int
    exercises: int
    sets: int
    weight_kg: float | None
    sleep_hours: float | None
    steps: int | None


class DayOut(BaseModel):
    day: date
    entries: list[EntryOut]
    summary: DaySummary


class TrainerOut(BaseModel):
    profile: Profile | None
    targets: Targets | None
    workout: WorkoutPlan | None
    diet: DietPlan | None
    coach_ready: bool


class ProgressOut(BaseModel):
    days: list[DaySummary]


class FoodRequest(Strict):
    text: str = Field(default="", max_length=300)
    photo_id: str | None = Field(default=None, pattern=PHOTO_ID)

    @model_validator(mode="after")
    def something_to_estimate(self) -> "FoodRequest":
        if not self.text and not self.photo_id:
            raise ValueError("Describe the food or add a photo of it.")
        return self


class FoodOut(BaseModel):
    items: list[FoodItem]


class PlanRequest(Strict):
    wishes: str = Field(default="", max_length=300)
    day: Weekday | None = None


class CoachLine(Strict):
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=4000)


class CoachRequest(Strict):
    messages: list[CoachLine] = Field(min_length=1, max_length=30)
    day: date
    now: AwareDatetime | None = None


class CoachAction(BaseModel):
    kind: Literal["show_exercise", "start_workout", "open"]
    exercise_id: str | None = None
    query: str | None = None
    page: Page | None = None


class CoachReply(BaseModel):
    answer: str
    logged: list[EntryOut]
    actions: list[CoachAction] = Field(default_factory=list)


class PhotoOut(BaseModel):
    id: str
    day: date
    kind: PhotoKind
    created_at: datetime
    size: int


class PhotoList(BaseModel):
    photos: list[PhotoOut]


class LibraryCard(BaseModel):
    id: str
    name: str
    equipment: str
    category: str
    level: str
    primary: list[str]
    secondary: list[str]
    images: list[str]


class LibraryExercise(LibraryCard):
    force: str | None
    mechanic: str | None
    instructions: list[str]


class LibraryOut(BaseModel):
    exercises: list[LibraryCard]
    source: str


class TrainerExport(BaseModel):
    exported_at: datetime
    profile: Profile | None
    workout: WorkoutPlan | None
    diet: DietPlan | None
    entries: list[EntryOut]
    photos: list[PhotoOut]
