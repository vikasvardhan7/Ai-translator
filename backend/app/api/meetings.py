from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.api.dependencies import (
    get_app_settings,
    get_meeting_store,
    get_public_address,
    get_room_store,
    is_owner,
    require_host,
    require_member,
)
from app.api.links import public_link
from app.api.rooms import created, join_as_guest
from app.api.stream import tell_others
from app.core.config import Settings
from app.models.meeting import (
    MeetingCreate,
    MeetingCreated,
    MeetingHosted,
    MeetingJoin,
    MeetingList,
    MeetingOut,
    MeetingStart,
    MeetingStatus,
)
from app.models.room import RoomCreated, RoomJoined
from app.services.meeting_store import Meeting, MeetingLimitReached, MeetingStore
from app.services.public_address import PublicAddress
from app.services.room_store import HOST_ID, Room, RoomLimitReached, RoomStore

router = APIRouter(prefix="/api/meetings", tags=["meetings"])

Meetings = Annotated[MeetingStore, Depends(get_meeting_store)]
Rooms = Annotated[RoomStore, Depends(get_room_store)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
Public = Annotated[PublicAddress, Depends(get_public_address)]
MeetingToken = Annotated[str, Header(alias="X-Meeting-Token")]

NOT_FOUND = "This meeting does not exist or was cancelled. Ask the host for a new link."
NOT_VALID = "This link is not valid for this meeting."
NOT_STARTED = "The meeting has not started yet. You join as soon as the host starts it."
OVER = "This meeting is over. Ask the host to schedule a new one."


def live_room(meetings: MeetingStore, rooms: RoomStore, meeting: Meeting) -> Room | None:
    room_id = meetings.room_of(meeting.id)
    room = rooms.get(room_id) if room_id else None
    return room if room is not None and not room.ended else None


def _status(meeting: Meeting, room: Room | None) -> MeetingStatus:
    if room is not None:
        return "live"
    return "ended" if datetime.now(UTC) > meeting.ends_at else "upcoming"


def _out(meeting: Meeting, room: Room | None) -> dict:
    return {
        "id": meeting.id,
        "title": meeting.title,
        "starts_at": meeting.starts_at,
        "duration_minutes": meeting.duration_minutes,
        "agenda": meeting.agenda,
        "host_name": meeting.host_name,
        "status": _status(meeting, room),
        "people": len(room.conversation.participants) if room else 0,
    }


def _hosted(meeting: Meeting, room: Room | None) -> dict:
    return {
        **_out(meeting, room),
        "host_token": meeting.host_token,
        "invite_token": meeting.invite_token,
    }


def _find(meetings: MeetingStore, meeting_id: str, token: str, *, host: bool) -> Meeting:
    meeting = meetings.get(meeting_id)
    if meeting is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    if not (meeting.is_host(token) if host else meeting.allows(token)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_VALID)
    return meeting


Member = Annotated[str | None, Depends(require_member)]


@router.post("", response_model=MeetingCreated, status_code=status.HTTP_201_CREATED)
async def schedule(
    body: MeetingCreate,
    request: Request,
    meetings: Meetings,
    settings: AppSettings,
    public: Public,
    member: Member,
) -> MeetingCreated:
    try:
        meeting = meetings.create(
            body.title, body.starts_at, body.duration_minutes, body.agenda, body.host_name, member
        )
    except MeetingLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Too many meetings are scheduled. Cancel some old ones first.",
        ) from exc
    public_url, problem = await public_link(request, settings, public)
    return MeetingCreated(
        **_hosted(meeting, None), public_url=public_url, public_url_problem=problem
    )


@router.get("", response_model=MeetingList)
async def upcoming(
    request: Request,
    meetings: Meetings,
    rooms: Rooms,
    settings: AppSettings,
    public: Public,
    member: Member,
) -> MeetingList:
    found = [
        MeetingHosted(**_hosted(meeting, live_room(meetings, rooms, meeting)))
        for meeting in meetings.upcoming(member, with_unowned=is_owner(request))
    ]
    public_url, problem = await public_link(request, settings, public)
    return MeetingList(meetings=found, public_url=public_url, public_url_problem=problem)


@router.get("/{meeting_id}", response_model=MeetingOut, dependencies=[Depends(require_host)])
async def look(
    meeting_id: str, token: MeetingToken, meetings: Meetings, rooms: Rooms
) -> MeetingOut:
    meeting = _find(meetings, meeting_id, token, host=False)
    return MeetingOut(**_out(meeting, live_room(meetings, rooms, meeting)))


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel(meeting_id: str, token: MeetingToken, meetings: Meetings, rooms: Rooms) -> None:
    meeting = _find(meetings, meeting_id, token, host=True)
    room = live_room(meetings, rooms, meeting)
    if room is not None:
        rooms.leave(room, HOST_ID)
        tell_others(room, HOST_ID, "peer.left")
    meetings.cancel(meeting.id)


@router.post("/{meeting_id}/start", response_model=RoomCreated)
async def start(
    meeting_id: str,
    body: MeetingStart,
    token: MeetingToken,
    request: Request,
    meetings: Meetings,
    rooms: Rooms,
    settings: AppSettings,
    public: Public,
) -> RoomCreated:
    meeting = _find(meetings, meeting_id, token, host=True)
    room = live_room(meetings, rooms, meeting)
    if room is None:
        if meeting.is_over(datetime.now(UTC)):
            raise HTTPException(status.HTTP_410_GONE, OVER)
        try:
            room = rooms.create(body.host)
        except RoomLimitReached as exc:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Too many conversations are waiting to start. Try again in a few minutes.",
            ) from exc
        meetings.open_room(meeting.id, room.id)
    public_url, problem = await public_link(request, settings, public)
    return created(room, public_url, problem)


@router.post("/{meeting_id}/join", response_model=RoomJoined, dependencies=[Depends(require_host)])
async def join(meeting_id: str, body: MeetingJoin, meetings: Meetings, rooms: Rooms) -> RoomJoined:
    meeting = _find(meetings, meeting_id, body.token, host=False)
    room = live_room(meetings, rooms, meeting)
    if room is None:
        over = meeting.is_over(datetime.now(UTC))
        raise HTTPException(
            status.HTTP_410_GONE if over else status.HTTP_409_CONFLICT,
            OVER if over else NOT_STARTED,
        )
    return join_as_guest(rooms, room, body.guest)
