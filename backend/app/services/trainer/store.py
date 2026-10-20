import sqlite3
import threading
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from pydantic import TypeAdapter

from app.models.trainer import (
    DaySummary,
    DietPlan,
    EntryData,
    EntryOut,
    PhotoKind,
    PhotoOut,
    PlanKind,
    Profile,
    WorkoutPlan,
)

MAX_ENTRIES_PER_DAY = 300
MAX_PHOTOS_PER_DAY = 30
MAX_PHOTOS = 600
UNUSED_PHOTO_AGE = timedelta(days=1)

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
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_by_user ON photos (user_id, kind, day);
"""
ENTRY = TypeAdapter(EntryData)
PLANS: dict[str, type[WorkoutPlan] | type[DietPlan]] = {"workout": WorkoutPlan, "diet": DietPlan}


class DayFull(Exception):
    pass


class TooManyPhotos(Exception):
    pass


class UnknownPhoto(Exception):
    pass


class PhotoInUse(Exception):
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


def _photo(row: tuple) -> PhotoOut:
    id_, day, kind, created_at, size = row
    return PhotoOut(
        id=id_,
        day=date.fromisoformat(day),
        kind=kind,
        created_at=datetime.fromisoformat(created_at),
        size=size,
    )


PHOTO_COLUMNS = "id, day, kind, created_at, length(data)"
USED_PHOTOS = (
    "SELECT json_extract(data, '$.photo_id') FROM entries WHERE user_id = ?"
    " AND json_extract(data, '$.photo_id') IS NOT NULL"
)
DROP_UNUSED_PHOTO = f"DELETE FROM photos WHERE id = ? AND user_id = ? AND id NOT IN ({USED_PHOTOS})"


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
        photo_id = getattr(data, "photo_id", None)
        with self._lock:
            db = self._db()
            (count,) = db.execute(
                "SELECT COUNT(*) FROM entries WHERE user_id = ? AND day = ?",
                (user_id, day.isoformat()),
            ).fetchone()
            if count >= MAX_ENTRIES_PER_DAY:
                raise DayFull
            if (
                photo_id
                and not db.execute(
                    "SELECT 1 FROM photos WHERE id = ? AND user_id = ? AND kind = 'meal'",
                    (photo_id, user_id),
                ).fetchone()
            ):
                raise UnknownPhoto
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
            row = db.execute(
                "SELECT json_extract(data, '$.photo_id') FROM entries WHERE id = ? AND user_id = ?",
                (entry_id, user_id),
            ).fetchone()
            if row is None:
                return False
            db.execute("DELETE FROM entries WHERE id = ? AND user_id = ?", (entry_id, user_id))
            if row[0]:
                db.execute(DROP_UNUSED_PHOTO, (row[0], user_id, user_id))
            db.commit()
        return True

    def add_photo(
        self, user_id: str, day: date, kind: PhotoKind, mime: str, data: bytes
    ) -> PhotoOut:
        now = _now()
        photo = PhotoOut(id=uuid.uuid4().hex, day=day, kind=kind, created_at=now, size=len(data))
        with self._lock:
            db = self._db()
            db.execute(
                f"DELETE FROM photos WHERE user_id = ? AND kind = 'meal' AND created_at < ?"
                f" AND id NOT IN ({USED_PHOTOS})",
                (user_id, (now - UNUSED_PHOTO_AGE).isoformat(), user_id),
            )
            (today, everything) = db.execute(
                "SELECT COUNT(CASE WHEN day = ? THEN 1 END), COUNT(*) FROM photos"
                " WHERE user_id = ?",
                (day.isoformat(), user_id),
            ).fetchone()
            if today >= MAX_PHOTOS_PER_DAY or everything >= MAX_PHOTOS:
                db.commit()
                raise TooManyPhotos
            db.execute(
                "INSERT INTO photos VALUES (?, ?, ?, ?, ?, ?, ?)",
                (photo.id, user_id, day.isoformat(), kind, mime, data, now.isoformat()),
            )
            db.commit()
        return photo

    def photo(self, user_id: str, photo_id: str) -> tuple[str, bytes] | None:
        with self._lock:
            row = (
                self._db()
                .execute(
                    "SELECT mime, data FROM photos WHERE id = ? AND user_id = ?",
                    (photo_id, user_id),
                )
                .fetchone()
            )
        return (row[0], bytes(row[1])) if row else None

    def photos(self, user_id: str, kind: PhotoKind | None = None) -> list[PhotoOut]:
        with self._lock:
            rows = (
                self._db()
                .execute(
                    f"SELECT {PHOTO_COLUMNS} FROM photos WHERE user_id = ?"
                    " AND (? IS NULL OR kind = ?) ORDER BY day DESC, created_at DESC",
                    (user_id, kind, kind),
                )
                .fetchall()
            )
        return [_photo(row) for row in rows]

    def remove_photo(self, user_id: str, photo_id: str) -> bool:
        with self._lock:
            db = self._db()
            if not db.execute(
                "SELECT 1 FROM photos WHERE id = ? AND user_id = ?", (photo_id, user_id)
            ).fetchone():
                return False
            removed = db.execute(DROP_UNUSED_PHOTO, (photo_id, user_id, user_id)).rowcount
            db.commit()
        if not removed:
            raise PhotoInUse
        return True

    def forget(self, user_id: str) -> None:
        with self._lock:
            db = self._db()
            for table in ("profiles", "plans", "entries", "photos"):
                db.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
            db.commit()
