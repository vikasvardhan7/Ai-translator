import hashlib
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

KEY_PREFIX = "vt_"
SHOWN_CHARACTERS = 10
MAX_KEYS = 100
TOUCH_EVERY = timedelta(minutes=1)

SCHEMA = """
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    shown TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE,
    daily_limit INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
)
"""
COLUMNS = "id, name, shown, secret_hash, daily_limit, created_at, last_used_at"


class KeyLimitReached(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


@dataclass(frozen=True)
class ApiKey:
    id: str
    name: str
    shown: str
    daily_limit: int
    created_at: datetime
    last_used_at: datetime | None


def _key(row: tuple) -> ApiKey:
    id_, name, shown, _, daily_limit, created_at, last_used_at = row
    return ApiKey(
        id=id_,
        name=name,
        shown=shown,
        daily_limit=daily_limit,
        created_at=datetime.fromisoformat(created_at),
        last_used_at=datetime.fromisoformat(last_used_at) if last_used_at else None,
    )


class KeyStore:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._touched: dict[str, datetime] = {}

    def _db(self) -> sqlite3.Connection:
        if self._connection is None:
            if self._path is None:
                target = ":memory:"
            else:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                target = str(self._path)
            self._connection = sqlite3.connect(target, check_same_thread=False)
            self._connection.execute(SCHEMA)
            self._connection.commit()
        return self._connection

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def create(self, name: str, daily_limit: int) -> tuple[ApiKey, str]:
        secret = KEY_PREFIX + secrets.token_urlsafe(32)
        key = ApiKey(
            id=str(uuid.uuid4()),
            name=name,
            shown=secret[:SHOWN_CHARACTERS],
            daily_limit=daily_limit,
            created_at=_now(),
            last_used_at=None,
        )
        with self._lock:
            db = self._db()
            (count,) = db.execute("SELECT COUNT(*) FROM api_keys").fetchone()
            if count >= MAX_KEYS:
                raise KeyLimitReached
            db.execute(
                f"INSERT INTO api_keys ({COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    key.id,
                    key.name,
                    key.shown,
                    _hash(secret),
                    key.daily_limit,
                    key.created_at.isoformat(),
                    None,
                ),
            )
            db.commit()
        return key, secret

    def all(self) -> list[ApiKey]:
        with self._lock:
            rows = self._db().execute(f"SELECT {COLUMNS} FROM api_keys ORDER BY created_at")
            return [_key(row) for row in rows.fetchall()]

    def find(self, secret: str) -> ApiKey | None:
        if not secret.startswith(KEY_PREFIX):
            return None
        with self._lock:
            row = (
                self._db()
                .execute(f"SELECT {COLUMNS} FROM api_keys WHERE secret_hash = ?", (_hash(secret),))
                .fetchone()
            )
        return _key(row) if row else None

    def revoke(self, key_id: str) -> bool:
        with self._lock:
            db = self._db()
            removed = db.execute("DELETE FROM api_keys WHERE id = ?", (key_id,)).rowcount
            db.commit()
            self._touched.pop(key_id, None)
        return removed > 0

    def touch(self, key: ApiKey) -> None:
        now = _now()
        last = self._touched.get(key.id)
        if last is not None and now - last < TOUCH_EVERY:
            return
        self._touched[key.id] = now
        with self._lock:
            db = self._db()
            db.execute(
                "UPDATE api_keys SET last_used_at = ? WHERE id = ?", (now.isoformat(), key.id)
            )
            db.commit()
