import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

KEEP_AFTER_END = timedelta(days=7)
JOIN_AFTER_END = timedelta(hours=2)
MAX_MEETINGS = 500

SCHEMA = """
CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    agenda TEXT NOT NULL,
    host_name TEXT NOT NULL,
    host_token TEXT NOT NULL,
    invite_token TEXT NOT NULL,
    created_at TEXT NOT NULL
)
"""
COLUMNS = (
    "id, title, starts_at, duration_minutes, agenda, host_name, host_token, invite_token,"
    " created_at"
)


class MeetingLimitReached(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _same_token(given: str, expected: str) -> bool:
    return bool(given) and secrets.compare_digest(given.encode(), expected.encode())


@dataclass(frozen=True)
class Meeting:
    id: str
    title: str
    starts_at: datetime
    duration_minutes: int
    agenda: str
    host_name: str
    host_token: str
    invite_token: str
    created_at: datetime

    @property
    def ends_at(self) -> datetime:
        return self.starts_at + timedelta(minutes=self.duration_minutes)

    def is_host(self, token: str) -> bool:
        return _same_token(token, self.host_token)

    def allows(self, token: str) -> bool:
        return self.is_host(token) or _same_token(token, self.invite_token)

    def is_over(self, now: datetime) -> bool:
        return now > self.ends_at + JOIN_AFTER_END


def _meeting(row: tuple) -> Meeting:
    id_, title, starts_at, duration, agenda, host_name, host_token, invite, created = row
    return Meeting(
        id=id_,
        title=title,
        starts_at=datetime.fromisoformat(starts_at),
        duration_minutes=duration,
        agenda=agenda,
        host_name=host_name,
        host_token=host_token,
        invite_token=invite,
        created_at=datetime.fromisoformat(created),
    )


class MeetingStore:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._rooms: dict[str, str] = {}

    def _db(self) -> sqlite3.Connection:
        if self._connection is None:
            if self._path is None:
                target = ":memory:"
            else:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                target = str(self._path)
            self._connection = sqlite3.connect(target, check_same_thread=False)
            self._connection.execute(SCHEMA)
            names = {row[1] for row in self._connection.execute("PRAGMA table_info(meetings)")}
            if "owner_id" not in names:
                self._connection.execute("ALTER TABLE meetings ADD COLUMN owner_id TEXT")
            self._connection.commit()
        return self._connection

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def create(
        self,
        title: str,
        starts_at: datetime,
        duration_minutes: int,
        agenda: str,
        host_name: str,
        owner_id: str | None = None,
    ) -> Meeting:
        meeting = Meeting(
            id=str(uuid.uuid4()),
            title=title,
            starts_at=starts_at.astimezone(UTC),
            duration_minutes=duration_minutes,
            agenda=agenda,
            host_name=host_name,
            host_token=secrets.token_urlsafe(),
            invite_token=secrets.token_urlsafe(),
            created_at=_now(),
        )
        with self._lock:
            db = self._db()
            self._drop_old(db)
            (count,) = db.execute("SELECT COUNT(*) FROM meetings").fetchone()
            if count >= MAX_MEETINGS:
                raise MeetingLimitReached
            db.execute(
                f"INSERT INTO meetings ({COLUMNS}, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    meeting.id,
                    meeting.title,
                    meeting.starts_at.isoformat(),
                    meeting.duration_minutes,
                    meeting.agenda,
                    meeting.host_name,
                    meeting.host_token,
                    meeting.invite_token,
                    meeting.created_at.isoformat(),
                    owner_id,
                ),
            )
            db.commit()
        return meeting

    def get(self, meeting_id: str) -> Meeting | None:
        with self._lock:
            row = (
                self._db()
                .execute(f"SELECT {COLUMNS} FROM meetings WHERE id = ?", (meeting_id,))
                .fetchone()
            )
        return _meeting(row) if row else None

    def upcoming(self, owner_id: str | None, *, with_unowned: bool) -> list[Meeting]:
        now = _now()
        with self._lock:
            db = self._db()
            self._drop_old(db)
            rows = db.execute(
                f"SELECT {COLUMNS} FROM meetings WHERE owner_id IS ?"
                " OR (? AND owner_id IS NULL) ORDER BY starts_at",
                (owner_id, with_unowned),
            ).fetchall()
        return [meeting for meeting in map(_meeting, rows) if not meeting.is_over(now)]

    def forget_owner(self, owner_id: str) -> None:
        with self._lock:
            db = self._db()
            gone = [
                row[0]
                for row in db.execute("SELECT id FROM meetings WHERE owner_id = ?", (owner_id,))
            ]
            db.execute("DELETE FROM meetings WHERE owner_id = ?", (owner_id,))
            db.commit()
        for meeting_id in gone:
            self._rooms.pop(meeting_id, None)

    def cancel(self, meeting_id: str) -> None:
        with self._lock:
            db = self._db()
            db.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
            db.commit()
            self._rooms.pop(meeting_id, None)

    def room_of(self, meeting_id: str) -> str | None:
        return self._rooms.get(meeting_id)

    def open_room(self, meeting_id: str, room_id: str) -> None:
        self._rooms[meeting_id] = room_id

    def _drop_old(self, db: sqlite3.Connection) -> None:
        cutoff = _now() - KEEP_AFTER_END
        for meeting in map(_meeting, db.execute(f"SELECT {COLUMNS} FROM meetings").fetchall()):
            if meeting.ends_at < cutoff:
                db.execute("DELETE FROM meetings WHERE id = ?", (meeting.id,))
                self._rooms.pop(meeting.id, None)
        db.commit()
