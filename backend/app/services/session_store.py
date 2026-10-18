import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.models.session import Participant


@dataclass
class Session:
    id: str
    participants: list[Participant]
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def create(self, participants: list[Participant]) -> Session:
        ordered = sorted(participants, key=lambda p: p.id)
        session = Session(id=str(uuid.uuid4()), participants=ordered)
        self._sessions[session.id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)
