import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.models.session import Participant, SessionMode

UNOPENED_SESSION_LIFETIME = timedelta(minutes=10)
MAX_UNOPENED_SESSIONS = 100

ConversationMode = SessionMode | Literal["remote"]


class SessionLimitReached(Exception):
    pass


@dataclass
class Session:
    id: str
    participants: list[Participant]
    mode: ConversationMode
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class SessionStore:
    def __init__(self) -> None:
        self._unopened: dict[str, Session] = {}

    def create(self, participants: list[Participant], mode: SessionMode) -> Session:
        self._drop_expired()
        if len(self._unopened) >= MAX_UNOPENED_SESSIONS:
            raise SessionLimitReached
        ordered = sorted(participants, key=lambda p: p.id)
        session = Session(id=str(uuid.uuid4()), participants=ordered, mode=mode)
        self._unopened[session.id] = session
        return session

    def take(self, session_id: str) -> Session | None:
        self._drop_expired()
        return self._unopened.pop(session_id, None)

    def _expired(self, session: Session) -> bool:
        return datetime.now(UTC) - session.created_at > UNOPENED_SESSION_LIFETIME

    def _drop_expired(self) -> None:
        for session_id in [s.id for s in self._unopened.values() if self._expired(s)]:
            del self._unopened[session_id]
