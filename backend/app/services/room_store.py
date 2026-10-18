import secrets
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.core.text import MAX_RECENT_TRANSLATIONS
from app.models.session import Participant, ParticipantId, Person
from app.services.session_store import Session

IDLE_ROOM_LIFETIME = timedelta(minutes=30)
UNJOINED_ROOM_LIFETIME = timedelta(minutes=10)
MAX_WAITING_ROOMS = 100
HOST_ID: ParticipantId = "A"
GUEST_ID: ParticipantId = "B"


class RoomLimitReached(Exception):
    pass


class Device(Protocol):
    async def send(self, message_type: str, **fields: Any) -> None: ...


def _now() -> datetime:
    return datetime.now(UTC)


def _same_token(given: str, expected: str) -> bool:
    return secrets.compare_digest(given.encode(), expected.encode())


@dataclass
class Room:
    id: str
    host: Participant
    guest: Participant | None = None
    host_token: str = field(default_factory=secrets.token_urlsafe)
    guest_token: str = field(default_factory=secrets.token_urlsafe)
    idle_since: datetime = field(default_factory=_now)
    devices: dict[str, Device] = field(default_factory=dict)
    connected_once: set[str] = field(default_factory=set)
    server_voice_for: set[str] = field(default_factory=lambda: {HOST_ID, GUEST_ID})
    voice_for: dict[str, str] = field(default_factory=dict)
    recent_translations: deque[tuple[float, str]] = field(
        default_factory=lambda: deque(maxlen=MAX_RECENT_TRANSLATIONS)
    )

    def participant_for(self, token: str) -> ParticipantId | None:
        if _same_token(token, self.host_token):
            return HOST_ID
        if _same_token(token, self.guest_token):
            return GUEST_ID
        return None

    def session(self) -> Session:
        participants = [p for p in (self.host, self.guest) if p is not None]
        return Session(id=self.id, participants=participants, mode="remote")


class RoomStore:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def create(self, host: Person) -> Room:
        self._drop_expired()
        if sum(not room.devices for room in self._rooms.values()) >= MAX_WAITING_ROOMS:
            raise RoomLimitReached
        room = Room(id=str(uuid.uuid4()), host=Participant(id=HOST_ID, **host.model_dump()))
        self._rooms[room.id] = room
        return room

    def get(self, room_id: str) -> Room | None:
        self._drop_expired()
        return self._rooms.get(room_id)

    def join(self, room: Room, guest: Person) -> str:
        room.guest = Participant(id=GUEST_ID, **guest.model_dump())
        room.guest_token = secrets.token_urlsafe()
        room.idle_since = _now()
        return room.guest_token

    def connect(self, room: Room, participant_id: str, device: Device) -> bool:
        if participant_id in room.devices:
            return False
        room.devices[participant_id] = device
        room.connected_once.add(participant_id)
        return True

    def disconnect(self, room: Room, participant_id: str) -> None:
        room.devices.pop(participant_id, None)
        room.idle_since = _now()
        if not room.devices and room.connected_once == {HOST_ID, GUEST_ID}:
            self._rooms.pop(room.id, None)

    def _expired(self, room: Room) -> bool:
        lifetime = IDLE_ROOM_LIFETIME if room.guest else UNJOINED_ROOM_LIFETIME
        return not room.devices and _now() - room.idle_since > lifetime

    def _drop_expired(self) -> None:
        for room_id in [room.id for room in self._rooms.values() if self._expired(room)]:
            del self._rooms[room_id]
