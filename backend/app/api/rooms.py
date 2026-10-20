from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, status

from app.api.dependencies import (
    get_app_settings,
    get_public_address,
    get_room_store,
    get_speech_synthesizer,
    get_speech_translator,
    request_budget,
    require_host,
)
from app.api.links import public_link
from app.api.stream import announce_people, handle_room_stream, tell_others
from app.core.config import Settings
from app.models.room import RoomCreate, RoomCreated, RoomJoin, RoomJoined, RoomOut
from app.models.session import Person
from app.services.limits import Budget
from app.services.public_address import PublicAddress
from app.services.room_store import (
    HOST_ID,
    MAX_PEOPLE,
    Room,
    RoomFull,
    RoomLimitReached,
    RoomStore,
)
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

Rooms = Annotated[RoomStore, Depends(get_room_store)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
Translator = Annotated[SpeechTranslator | None, Depends(get_speech_translator)]
Synthesizer = Annotated[SpeechSynthesizer | None, Depends(get_speech_synthesizer)]
Public = Annotated[PublicAddress, Depends(get_public_address)]
Spending = Annotated[Budget | None, Depends(request_budget)]


def _find(rooms: RoomStore, room_id: str) -> Room:
    room = rooms.get(room_id)
    if room is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "This conversation does not exist or has expired. Ask for a new invite link.",
        )
    return room


NOT_VALID = "This link is not valid for this conversation."


def created(room: Room, public_url: str | None, problem: str | None) -> RoomCreated:
    return RoomCreated(
        **_out(room).model_dump(),
        host_token=room.host_token,
        invite_token=room.invite_token,
        public_url=public_url,
        public_url_problem=problem,
    )


def _out(room: Room) -> RoomOut:
    return RoomOut(room_id=room.id, host=room.host, guests=room.guests, max_people=MAX_PEOPLE)


@router.post(
    "",
    response_model=RoomCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_host)],
)
async def create_room(
    body: RoomCreate,
    request: Request,
    rooms: Rooms,
    settings: AppSettings,
    public: Public,
    budget: Spending,
) -> RoomCreated:
    try:
        room = rooms.create(body.host, budget)
    except RoomLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Too many conversations are waiting to start. Try again in a few minutes.",
        ) from exc
    public_url, problem = await public_link(request, settings, public)
    return created(room, public_url, problem)


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(
    room_id: str, rooms: Rooms, token: Annotated[str, Header(alias="X-Room-Token")]
) -> RoomOut:
    room = _find(rooms, room_id)
    if not room.allows(token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_VALID)
    return _out(room)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def leave_room(
    room_id: str, rooms: Rooms, token: Annotated[str, Header(alias="X-Room-Token")]
) -> None:
    room = _find(rooms, room_id)
    participant_id = room.participant_for(token)
    if participant_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_VALID)
    rooms.leave(room, participant_id)
    tell_others(room, participant_id, "peer.left")
    if participant_id != HOST_ID:
        announce_people(room)


@router.post("/{room_id}/join", response_model=RoomJoined, dependencies=[Depends(require_host)])
async def join_room(room_id: str, body: RoomJoin, rooms: Rooms) -> RoomJoined:
    room = _find(rooms, room_id)
    if not room.is_invite(body.token):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the invite link can be used to join this conversation."
        )
    return join_as_guest(rooms, room, body.guest)


def join_as_guest(rooms: RoomStore, room: Room, guest: Person) -> RoomJoined:
    if room.ended:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This conversation has ended.")
    try:
        you, token = rooms.join(room, guest)
    except RoomFull as exc:
        message = (
            "No more people can join this conversation. Ask the host to start a new one."
            if exc.people_left
            else f"This conversation is full: {MAX_PEOPLE} people are already in it."
        )
        raise HTTPException(status.HTTP_409_CONFLICT, message) from exc
    announce_people(room)
    return RoomJoined(**_out(room).model_dump(), token=token, you=you)


@router.websocket("/{room_id}/stream")
async def room_stream(
    websocket: WebSocket,
    room_id: str,
    rooms: Rooms,
    settings: AppSettings,
    translator: Translator,
    synthesizer: Synthesizer,
    token: str = "",
) -> None:
    await handle_room_stream(websocket, rooms, room_id, token, settings, translator, synthesizer)
