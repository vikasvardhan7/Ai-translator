import sqlite3
import threading
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

from pydantic import TypeAdapter

from app.models.trainer import (
    DaySummary,
    DietPlan,
    EntryData,
    EntryOut,
    PlanKind,
    Profile,
    WorkoutPlan,
)

MAX_ENTRIES_PER_DAY = 300

SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind)
);
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_by_day ON entries (user_id, day);
"""
ENTRY = TypeAdapter(EntryData)
PLANS: dict[str, type[WorkoutPlan] | type[DietPlan]] = {"workout": WorkoutPlan, "diet": DietPlan}


class DayFull(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _entry(row: tuple) -> EntryOut:
    id_, day, data, created_at = row
    return EntryOut(
        id=id_,
        day=date.fromisoformat(day),
        data=ENTRY.validate_json(data),
        created_at=datetime.fromisoformat(created_at),
    )


def summarise(day: date, entries: list[EntryOut]) -> DaySummary:
    meals = [entry.data for entry in entries if entry.data.kind == "meal"]
    exercises = [entry.data for entry in entries if entry.data.kind == "exercise"]
    weights = [entry.data.kg for entry in entries if entry.data.kind == "weight"]
    sleeps = [entry.data.hours for entry in entries if entry.data.kind == "sleep"]
    steps = [entry.data.count for entry in entries if entry.data.kind == "steps"]
    return DaySummary(
        day=day,
        calories=sum(meal.calories for meal in meals),
        protein_g=round(sum(meal.protein_g for meal in meals), 1),
        carbs_g=round(sum(meal.carbs_g for meal in meals), 1),
        fat_g=round(sum(meal.fat_g for meal in meals), 1),
        water_ml=sum(entry.data.ml for entry in entries if entry.data.kind == "water"),
        exercises=len({exercise.name.lower() for exercise in exercises}),
        sets=sum(exercise.sets for exercise in exercises),
        weight_kg=weights[-1] if weights else None,
        sleep_hours=round(sum(sleeps), 1) if sleeps else None,
        steps=max(steps) if steps else None,
    )


class TrainerStore:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.Lock()

    def _db(self) -> sqlite3.Connection:
        if self._connection is None:
            if self._path is None:
                target = ":memory:"
            else:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                target = str(self._path)
            self._connection = sqlite3.connect(target, check_same_thread=False)
            self._connection.executescript(SCHEMA)
            self._connection.commit()
        return self._connection

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def profile(self, user_id: str) -> Profile | None:
        with self._lock:
            row = (
                self._db()
                .execute("SELECT data FROM profiles WHERE user_id = ?", (user_id,))
                .fetchone()
            )
        return Profile.model_validate_json(row[0]) if row else None

    def save_profile(self, user_id: str, profile: Profile) -> None:
        with self._lock:
            db = self._db()
            db.execute(
                "INSERT OR REPLACE INTO profiles VALUES (?, ?, ?)",
                (user_id, profile.model_dump_json(), _now().isoformat()),
            )
            db.commit()

    def plan(self, user_id: str, kind: PlanKind) -> WorkoutPlan | DietPlan | None:
        with self._lock:
            row = (
                self._db()
                .execute("SELECT data FROM plans WHERE user_id = ? AND kind = ?", (user_id, kind))
                .fetchone()
            )
        return PLANS[kind].model_validate_json(row[0]) if row else None

    def save_plan(self, user_id: str, kind: PlanKind, plan: WorkoutPlan | DietPlan) -> None:
        with self._lock:
            db = self._db()
            db.execute(
                "INSERT OR REPLACE INTO plans VALUES (?, ?, ?, ?)",
                (user_id, kind, plan.model_dump_json(), _now().isoformat()),
            )
            db.commit()

    def add(self, user_id: str, day: date, data: EntryData) -> EntryOut:
        entry = EntryOut(id=str(uuid.uuid4()), day=day, data=data, created_at=_now())
        with self._lock:
            db = self._db()
            (count,) = db.execute(
                "SELECT COUNT(*) FROM entries WHERE user_id = ? AND day = ?",
                (user_id, day.isoformat()),
            ).fetchone()
            if count >= MAX_ENTRIES_PER_DAY:
                raise DayFull
            db.execute(
                "INSERT INTO entries VALUES (?, ?, ?, ?, ?)",
                (
                    entry.id,
                    user_id,
                    day.isoformat(),
                    ENTRY.dump_json(data).decode(),
                    entry.created_at.isoformat(),
                ),
            )
            db.commit()
        return entry

    def day(self, user_id: str, day: date) -> list[EntryOut]:
        with self._lock:
            rows = (
                self._db()
                .execute(
                    "SELECT id, day, data, created_at FROM entries WHERE user_id = ? AND day = ?"
                    " ORDER BY created_at",
                    (user_id, day.isoformat()),
                )
                .fetchall()
            )
        return [_entry(row) for row in rows]

    def between(self, user_id: str, first: date, last: date) -> list[EntryOut]:
        with self._lock:
            rows = (
                self._db()
                .execute(
                    "SELECT id, day, data, created_at FROM entries WHERE user_id = ?"
                    " AND day BETWEEN ? AND ? ORDER BY day, created_at",
                    (user_id, first.isoformat(), last.isoformat()),
                )
                .fetchall()
            )
        return [_entry(row) for row in rows]

    def everything(self, user_id: str) -> list[EntryOut]:
        return self.between(user_id, date.min, date.max)

    def remove(self, user_id: str, entry_id: str) -> bool:
        with self._lock:
            db = self._db()
            removed = db.execute(
                "DELETE FROM entries WHERE id = ? AND user_id = ?", (entry_id, user_id)
            ).rowcount
            db.commit()
        return removed > 0

    def forget(self, user_id: str) -> None:
        with self._lock:
            db = self._db()
            for table in ("profiles", "plans", "entries"):
                db.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            db.commit()
