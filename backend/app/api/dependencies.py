from fastapi import HTTPException, status
from starlette.requests import HTTPConnection

from app.core.access import ROOM_ID_HEADER, ROOM_TOKEN_HEADER, is_host
from app.core.config import Settings
from app.services.public_address import PublicAddress
from app.services.room_store import RoomStore
from app.services.session_store import SessionStore
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer

HOST_KEY_NEEDED = (
    "This app is open through a public link, so it needs the host key shown in the backend window."
)


def get_session_store(connection: HTTPConnection) -> SessionStore:
    return connection.app.state.sessions


def get_room_store(connection: HTTPConnection) -> RoomStore:
    return connection.app.state.rooms


def get_app_settings(connection: HTTPConnection) -> Settings:
    return connection.app.state.settings


def get_public_address(connection: HTTPConnection) -> PublicAddress:
    return connection.app.state.public_address


def get_speech_translator(connection: HTTPConnection) -> SpeechTranslator | None:
    return connection.app.state.speech_translator


def get_speech_synthesizer(connection: HTTPConnection) -> SpeechSynthesizer | None:
    return connection.app.state.speech_synthesizer


def is_host_request(connection: HTTPConnection) -> bool:
    state = connection.app.state
    return is_host(connection, state.host_key, key_everywhere=state.settings.host_key_everywhere)


def _is_invited(connection: HTTPConnection) -> bool:
    room = get_room_store(connection).get(connection.headers.get(ROOM_ID_HEADER, ""))
    token = connection.headers.get(ROOM_TOKEN_HEADER, "")
    return room is not None and bool(token) and room.participant_for(token) is not None


def require_host(connection: HTTPConnection) -> None:
    if not is_host_request(connection):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, HOST_KEY_NEEDED)


def require_host_or_guest(connection: HTTPConnection) -> None:
    if not (is_host_request(connection) or _is_invited(connection)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, HOST_KEY_NEEDED)
