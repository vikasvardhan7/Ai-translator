import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.models.session import Participant

UNOPENED_SESSION_LIFETIME = timedelta(minutes=10)
MAX_UNOPENED_SESSIONS = 100


class SessionLimitReached(Exception):
    pass


@dataclass
class Session:
    id: str
    participants: list[Participant]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def listener_for(self, speaker_id: str) -> Participant:
        return next(p for p in self.participants if p.id != speaker_id)


class SessionStore:
    def __init__(self) -> None:
        self._unopened: dict[str, Session] = {}

    def create(self, participants: list[Participant]) -> Session:
        self._drop_expired()
        if len(self._unopened) >= MAX_UNOPENED_SESSIONS:
            raise SessionLimitReached
        ordered = sorted(participants, key=lambda p: p.id)
        session = Session(id=str(uuid.uuid4()), participants=ordered)
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
