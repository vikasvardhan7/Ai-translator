from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, WebSocket, status

from app.api.dependencies import (
    get_app_settings,
    get_public_address,
    get_room_store,
    get_speech_synthesizer,
    get_speech_translator,
    require_host,
)
from app.api.stream import announce_people, handle_room_stream, tell_others
from app.core.access import is_local_page, own_origin
from app.core.config import Settings
from app.models.room import RoomCreate, RoomCreated, RoomJoin, RoomJoined, RoomOut
from app.services.public_address import DID_NOT_START, PublicAddress
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


def _find(rooms: RoomStore, room_id: str) -> Room:
    room = rooms.get(room_id)
    if room is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "This conversation does not exist or has expired. Ask for a new invite link.",
        )
    return room


NOT_VALID = "This link is not valid for this conversation."


def _out(room: Room) -> RoomOut:
    return RoomOut(room_id=room.id, host=room.host, guests=room.guests, max_people=MAX_PEOPLE)


@router.post(
    "",
    response_model=RoomCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_host)],
)
async def create_room(
    body: RoomCreate, request: Request, rooms: Rooms, settings: AppSettings, public: Public
) -> RoomCreated:
    try:
        room = rooms.create(body.host)
    except RoomLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Too many conversations are waiting to start. Try again in a few minutes.",
        ) from exc
    public_url, problem = await _public_link(request, settings, public)
    return RoomCreated(
        **_out(room).model_dump(),
        host_token=room.host_token,
        invite_token=room.invite_token,
        public_url=public_url,
        public_url_problem=problem,
    )


async def _public_link(
    request: Request, settings: Settings, public: PublicAddress
) -> tuple[str | None, str | None]:
    if settings.public_url:
        return settings.public_url.rstrip("/"), None
    if not is_local_page(request):
        return own_origin(request), None
    if public.problem is not None:
        return None, public.problem
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    address = await public.get(f"http://localhost:{port}")
    return address, None if address else DID_NOT_START


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


@router.post("/{room_id}/join", response_model=RoomJoined)
async def join_room(room_id: str, body: RoomJoin, rooms: Rooms) -> RoomJoined:
    room = _find(rooms, room_id)
    if room.ended:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This conversation has ended.")
    if not room.is_invite(body.token):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the invite link can be used to join this conversation."
        )
    try:
        you, token = rooms.join(room, body.guest)
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
