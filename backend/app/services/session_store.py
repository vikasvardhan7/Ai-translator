import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from app.models.session import Participant, SessionMode
from app.services.limits import Budget

LIFETIME_WITHOUT_DEVICE = timedelta(minutes=10)
MAX_WAITING_SESSIONS = 100

ConversationMode = SessionMode | Literal["remote"]


class SessionLimitReached(Exception):
    pass


class Device(Protocol):
    async def send(self, message_type: str, **fields: Any) -> None: ...

    def post(self, message_type: str, **fields: Any) -> None: ...

    async def close(self, code: int) -> None: ...


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Session:
    id: str
    participants: list[Participant]
    mode: ConversationMode
    created_at: datetime = field(default_factory=_now)
    idle_since: datetime = field(default_factory=_now)
    device: Device | None = None
    budget: Budget | None = None


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(
        self, participants: list[Participant], mode: SessionMode, budget: Budget | None = None
    ) -> Session:
        self._drop_expired()
        if sum(s.device is None for s in self._sessions.values()) >= MAX_WAITING_SESSIONS:
            raise SessionLimitReached
        ordered = sorted(participants, key=lambda p: p.id)
        session = Session(id=str(uuid.uuid4()), participants=ordered, mode=mode, budget=budget)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        self._drop_expired()
        return self._sessions.get(session_id)

    def connect(self, session: Session, device: Device) -> Device | None:
        replaced, session.device = session.device, device
        return replaced

    def disconnect(self, session: Session, device: Device, *, ended: bool) -> None:
        if session.device is not device:
            return
        session.device = None
        session.idle_since = _now()
        if ended:
            self._sessions.pop(session.id, None)

    def _expired(self, session: Session) -> bool:
        return session.device is None and _now() - session.idle_since > LIFETIME_WITHOUT_DEVICE

    def _drop_expired(self) -> None:
        for session_id in [s.id for s in self._sessions.values() if self._expired(s)]:
            del self._sessions[session_id]
