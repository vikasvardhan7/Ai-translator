import secrets
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from app.core.text import CONTEXT_SENTENCES, MAX_REMEMBERED, PlayedVoice
from app.models.session import Participant, ParticipantId, Person
from app.services.limits import Budget
from app.services.session_store import Device, Session

IDLE_ROOM_LIFETIME = timedelta(minutes=30)
UNJOINED_ROOM_LIFETIME = timedelta(minutes=10)
ABSENT_LIMIT = timedelta(minutes=2)
MAX_WAITING_ROOMS = 100
HOST_ID: ParticipantId = "A"
GUEST_IDS: tuple[ParticipantId, ...] = ("B", "C", "D", "E", "F")
MAX_PEOPLE = 4
MAX_CHAT_LINES = 200


class RoomLimitReached(Exception):
    pass


class RoomFull(Exception):
    def __init__(self, *, people_left: bool) -> None:
        super().__init__()
        self.people_left = people_left


def _now() -> datetime:
    return datetime.now(UTC)


def _same_token(given: str, expected: str) -> bool:
    return secrets.compare_digest(given.encode(), expected.encode())


@dataclass
class Room:
    id: str
    conversation: Session
    host_token: str = field(default_factory=secrets.token_urlsafe)
    invite_token: str = field(default_factory=secrets.token_urlsafe)
    guest_tokens: dict[ParticipantId, str] = field(default_factory=dict)
    left: set[str] = field(default_factory=set)
    idle_since: datetime = field(default_factory=_now)
    devices: dict[str, Device] = field(default_factory=dict)
    ended: bool = False
    server_voice_for: set[str] = field(default_factory=lambda: {HOST_ID})
    voice_for: dict[str, str] = field(default_factory=dict)
    recent_voices: deque[PlayedVoice] = field(default_factory=lambda: deque(maxlen=MAX_REMEMBERED))
    translations: dict[tuple[str, str], str] = field(default_factory=dict)
    recent_sentences: deque[str] = field(default_factory=lambda: deque(maxlen=CONTEXT_SENTENCES))
    chat: deque[dict[str, str]] = field(default_factory=lambda: deque(maxlen=MAX_CHAT_LINES))
    recording: set[str] = field(default_factory=set)
    media: dict[str, dict[str, bool]] = field(default_factory=dict)
    absent_since: dict[str, datetime] = field(default_factory=dict)

    @property
    def host(self) -> Participant:
        return next(p for p in self.conversation.participants if p.id == HOST_ID)

    @property
    def guests(self) -> list[Participant]:
        return [p for p in self.conversation.participants if p.id != HOST_ID]

    def participant_for(self, token: str) -> ParticipantId | None:
        if _same_token(token, self.host_token):
            return HOST_ID
        for participant_id, guest_token in self.guest_tokens.items():
            if _same_token(token, guest_token):
                return participant_id
        return None

    def is_invite(self, token: str) -> bool:
        return _same_token(token, self.invite_token)

    def allows(self, token: str) -> bool:
        return self.participant_for(token) is not None or self.is_invite(token)

    def session(self) -> Session:
        return self.conversation


class RoomStore:
    def __init__(self) -> None:
        self._rooms: dict[str, Room] = {}

    def create(self, host: Person, budget: Budget | None = None) -> Room:
        self._drop_expired()
        if sum(not room.devices for room in self._rooms.values()) >= MAX_WAITING_ROOMS:
            raise RoomLimitReached
        room_id = str(uuid.uuid4())
        participant = Participant(id=HOST_ID, **host.model_dump())
        conversation = Session(room_id, [participant], "remote", budget=budget)
        room = Room(id=room_id, conversation=conversation)
        self._rooms[room.id] = room
        return room

    def get(self, room_id: str) -> Room | None:
        self._drop_expired()
        return self._rooms.get(room_id)

    def join(self, room: Room, guest: Person) -> tuple[ParticipantId, str]:
        if len(room.conversation.participants) >= MAX_PEOPLE:
            raise RoomFull(people_left=False)
        used = room.guest_tokens.keys() | room.left
        free = next((guest_id for guest_id in GUEST_IDS if guest_id not in used), None)
        if free is None:
            raise RoomFull(people_left=True)
        participants = room.conversation.participants
        participants.append(Participant(id=free, **guest.model_dump()))
        participants.sort(key=lambda p: p.id)
        token = secrets.token_urlsafe()
        room.guest_tokens[free] = token
        room.server_voice_for.add(free)
        room.idle_since = _now()
        room.absent_since[free] = _now()
        return free, token

    def drop_absent(self, room: Room) -> list[str]:
        """Guests whose device has been gone for a while have left: their tile and place free up."""
        cutoff = _now() - ABSENT_LIMIT
        gone = [
            participant_id
            for participant_id, since in room.absent_since.items()
            if participant_id != HOST_ID and participant_id not in room.devices and since < cutoff
        ]
        for participant_id in gone:
            self.leave(room, participant_id)
        return gone

    def leave(self, room: Room, participant_id: str) -> None:
        if participant_id == HOST_ID:
            self.end(room)
            return
        room.conversation.participants[:] = [
            p for p in room.conversation.participants if p.id != participant_id
        ]
        room.guest_tokens.pop(participant_id, None)
        room.left.add(participant_id)
        room.server_voice_for.discard(participant_id)
        room.voice_for.pop(participant_id, None)
        room.recording.discard(participant_id)
        room.media.pop(participant_id, None)
        room.absent_since.pop(participant_id, None)

    def connect(self, room: Room, participant_id: str, device: Device) -> Device | None:
        replaced = room.devices.get(participant_id)
        room.devices[participant_id] = device
        room.absent_since.pop(participant_id, None)
        return replaced

    def disconnect(self, room: Room, participant_id: str, device: Device, *, ended: bool) -> bool:
        if room.devices.get(participant_id) is not device:
            return False
        del room.devices[participant_id]
        room.idle_since = _now()
        if ended:
            self.leave(room, participant_id)
        else:
            room.absent_since[participant_id] = _now()
        if room.ended and not room.devices:
            self._rooms.pop(room.id, None)
        return True

    def end(self, room: Room) -> None:
        room.ended = True
        if not room.devices:
            self._rooms.pop(room.id, None)

    def _expired(self, room: Room) -> bool:
        lifetime = IDLE_ROOM_LIFETIME if room.guests else UNJOINED_ROOM_LIFETIME
        return not room.devices and _now() - room.idle_since > lifetime

    def _drop_expired(self) -> None:
        for room_id in [room.id for room in self._rooms.values() if self._expired(room)]:
            del self._rooms[room_id]
