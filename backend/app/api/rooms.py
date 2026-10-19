from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, status

from app.api.dependencies import (
    get_app_settings,
    get_room_store,
    get_speech_synthesizer,
    get_speech_translator,
    require_host,
)
from app.api.stream import handle_room_stream, tell_others
from app.core.config import Settings
from app.models.room import RoomCreate, RoomCreated, RoomJoin, RoomJoined, RoomOut
from app.services.room_store import GUEST_ID, Room, RoomLimitReached, RoomStore
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer

router = APIRouter(prefix="/api/rooms", tags=["rooms"])

Rooms = Annotated[RoomStore, Depends(get_room_store)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
Translator = Annotated[SpeechTranslator | None, Depends(get_speech_translator)]
Synthesizer = Annotated[SpeechSynthesizer | None, Depends(get_speech_synthesizer)]


def _find(rooms: RoomStore, room_id: str) -> Room:
    room = rooms.get(room_id)
    if room is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "This conversation does not exist or has expired. Ask for a new invite link.",
        )
    return room


def _out(room: Room) -> RoomOut:
    return RoomOut(room_id=room.id, host=room.host, guest=room.guest)


@router.post(
    "",
    response_model=RoomCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_host)],
)
async def create_room(body: RoomCreate, rooms: Rooms) -> RoomCreated:
    try:
        room = rooms.create(body.host)
    except RoomLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Too many conversations are waiting to start. Try again in a few minutes.",
        ) from exc
    return RoomCreated(
        room_id=room.id,
        host_token=room.host_token,
        guest_token=room.guest_token,
        host=room.host,
        guest=None,
    )


@router.get("/{room_id}", response_model=RoomOut)
async def get_room(
    room_id: str, rooms: Rooms, token: Annotated[str, Header(alias="X-Room-Token")]
) -> RoomOut:
    room = _find(rooms, room_id)
    if room.participant_for(token) is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This link is not valid for this conversation."
        )
    return _out(room)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def leave_room(
    room_id: str, rooms: Rooms, token: Annotated[str, Header(alias="X-Room-Token")]
) -> None:
    room = _find(rooms, room_id)
    participant_id = room.participant_for(token)
    if participant_id is None:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This link is not valid for this conversation."
        )
    rooms.end(room)
    tell_others(room, participant_id, "peer.left")


@router.post("/{room_id}/join", response_model=RoomJoined)
async def join_room(room_id: str, body: RoomJoin, rooms: Rooms) -> RoomJoined:
    room = _find(rooms, room_id)
    if room.guest is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Someone has already joined this conversation."
        )
    if room.participant_for(body.token) != GUEST_ID:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the invite link can be used to join this conversation."
        )
    token = rooms.join(room, body.guest)
    return RoomJoined(room_id=room.id, host=room.host, guest=room.guest, token=token)


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
