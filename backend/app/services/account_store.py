import base64
import hashlib
import hmac
import secrets
import sqlite3
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal

CodePurpose = Literal["sign_up", "reset"]

CODE_DIGITS = 6
CODE_LIFETIME = timedelta(minutes=10)
CODE_GAP = timedelta(seconds=60)
CODE_TRIES = 5
SESSION_LIFETIME = timedelta(hours=12)
TOUCH_EVERY = timedelta(minutes=10)
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_LENGTH = 64
MAX_ACCOUNTS = 10_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codes (
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    tries INTEGER NOT NULL,
    PRIMARY KEY (email, purpose)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
"""
USER_COLUMNS = "id, email, name, password_hash, created_at"


class AccountExists(Exception):
    pass


class AccountLimitReached(Exception):
    pass


class CodeTooSoon(Exception):
    def __init__(self, wait_seconds: int) -> None:
        super().__init__()
        self.wait_seconds = wait_seconds


class CodeRefused(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def masked_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}" if domain else "***"


def normal_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_LENGTH
    )
    encoded = [base64.b64encode(part).decode() for part in (salt, derived)]
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${encoded[0]}${encoded[1]}"


def password_matches(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, expected = stored.split("$")
        if kind != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(base64.b64decode(expected)),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(derived, base64.b64decode(expected))


@dataclass(frozen=True)
class User:
    id: str
    email: str
    name: str
    created_at: datetime


def _user(row: tuple) -> tuple[User, str]:
    id_, email, name, password_hash, created_at = row
    return User(id_, email, name, datetime.fromisoformat(created_at)), password_hash


def _code_hash(email: str, purpose: str, code: str) -> str:
    return _digest(f"{purpose}:{email}:{code}")


class AccountStore:
    def __init__(self, path: Path | None) -> None:
        self._path = path
        self._connection: sqlite3.Connection | None = None
        self._lock = threading.Lock()
        self._unused_hash: str | None = None

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

    def find_by_email(self, email: str) -> User | None:
        with self._lock:
            row = (
                self._db()
                .execute(
                    f"SELECT {USER_COLUMNS} FROM users WHERE email = ?", (normal_email(email),)
                )
                .fetchone()
            )
        return _user(row)[0] if row else None

    def get(self, user_id: str) -> User | None:
        with self._lock:
            row = (
                self._db()
                .execute(f"SELECT {USER_COLUMNS} FROM users WHERE id = ?", (user_id,))
                .fetchone()
            )
        return _user(row)[0] if row else None

    def new_code(self, email: str, purpose: CodePurpose) -> str:
        email = normal_email(email)
        now = _now()
        code = "".join(secrets.choice("0123456789") for _ in range(CODE_DIGITS))
        with self._lock:
            db = self._db()
            row = db.execute(
                "SELECT sent_at FROM codes WHERE email = ? AND purpose = ?", (email, purpose)
            ).fetchone()
            if row is not None:
                waited = now - datetime.fromisoformat(row[0])
                if waited < CODE_GAP:
                    raise CodeTooSoon(max(1, int((CODE_GAP - waited).total_seconds()) + 1))
            db.execute(
                "INSERT OR REPLACE INTO codes VALUES (?, ?, ?, ?, ?, 0)",
                (
                    email,
                    purpose,
                    _code_hash(email, purpose, code),
                    (now + CODE_LIFETIME).isoformat(),
                    now.isoformat(),
                ),
            )
            db.commit()
        return code

    def use_code(self, email: str, purpose: CodePurpose, code: str) -> None:
        email = normal_email(email)
        with self._lock:
            db = self._db()
            row = db.execute(
                "SELECT code_hash, expires_at, tries FROM codes WHERE email = ? AND purpose = ?",
                (email, purpose),
            ).fetchone()
            if row is None:
                raise CodeRefused
            code_hash, expires_at, tries = row
            if tries >= CODE_TRIES or _now() > datetime.fromisoformat(expires_at):
                db.execute("DELETE FROM codes WHERE email = ? AND purpose = ?", (email, purpose))
                db.commit()
                raise CodeRefused
            if not hmac.compare_digest(code_hash, _code_hash(email, purpose, code.strip())):
                db.execute(
                    "UPDATE codes SET tries = tries + 1 WHERE email = ? AND purpose = ?",
                    (email, purpose),
                )
                db.commit()
                raise CodeRefused
            db.execute("DELETE FROM codes WHERE email = ? AND purpose = ?", (email, purpose))
            db.commit()

    def create(self, email: str, name: str, password: str) -> User:
        user = User(str(uuid.uuid4()), normal_email(email), name.strip(), _now())
        hashed = hash_password(password)
        with self._lock:
            db = self._db()
            (count,) = db.execute("SELECT COUNT(*) FROM users").fetchone()
            if count >= MAX_ACCOUNTS:
                raise AccountLimitReached
            try:
                db.execute(
                    f"INSERT INTO users ({USER_COLUMNS}) VALUES (?, ?, ?, ?, ?)",
                    (user.id, user.email, user.name, hashed, user.created_at.isoformat()),
                )
            except sqlite3.IntegrityError as exc:
                raise AccountExists from exc
            db.commit()
        return user

    def check_password(self, email: str, password: str) -> User | None:
        with self._lock:
            row = (
                self._db()
                .execute(
                    f"SELECT {USER_COLUMNS} FROM users WHERE email = ?", (normal_email(email),)
                )
                .fetchone()
            )
        if row is None:
            if self._unused_hash is None:
                self._unused_hash = hash_password(secrets.token_urlsafe(16))
            password_matches(password, self._unused_hash)
            return None
        user, stored = _user(row)
        return user if password_matches(password, stored) else None

    def password_ok(self, user: User, password: str) -> bool:
        return self.check_password(user.email, password) is not None

    def set_password(self, user_id: str, password: str) -> None:
        hashed = hash_password(password)
        with self._lock:
            db = self._db()
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user_id))
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            db.commit()

    def rename(self, user_id: str, name: str) -> None:
        with self._lock:
            db = self._db()
            db.execute("UPDATE users SET name = ? WHERE id = ?", (name.strip(), user_id))
            db.commit()

    def delete(self, user_id: str) -> None:
        with self._lock:
            db = self._db()
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            db.commit()

    def start_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = _now()
        with self._lock:
            db = self._db()
            db.execute("DELETE FROM sessions WHERE expires_at < ?", (now.isoformat(),))
            db.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?)",
                (_digest(token), user_id, (now + SESSION_LIFETIME).isoformat(), now.isoformat()),
            )
            db.commit()
        return token

    def session_user(self, token: str) -> User | None:
        if not token:
            return None
        now = _now()
        with self._lock:
            db = self._db()
            row = db.execute(
                f"SELECT {', '.join('u.' + c.strip() for c in USER_COLUMNS.split(','))},"
                " s.expires_at, s.seen_at FROM sessions s JOIN users u ON u.id = s.user_id"
                " WHERE s.token_hash = ?",
                (_digest(token),),
            ).fetchone()
            if row is None:
                return None
            expires_at, seen_at = datetime.fromisoformat(row[5]), datetime.fromisoformat(row[6])
            if now > expires_at:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_digest(token),))
                db.commit()
                return None
            if now - seen_at > TOUCH_EVERY:
                db.execute(
                    "UPDATE sessions SET seen_at = ?, expires_at = ? WHERE token_hash = ?",
                    (now.isoformat(), (now + SESSION_LIFETIME).isoformat(), _digest(token)),
                )
                db.commit()
        return _user(row[:5])[0]

    def end_session(self, token: str) -> None:
        with self._lock:
            db = self._db()
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (_digest(token),))
            db.commit()
