from starlette.requests import HTTPConnection

from app.core.config import Settings
from app.services.room_store import RoomStore
from app.services.session_store import SessionStore
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer


def get_session_store(connection: HTTPConnection) -> SessionStore:
    return connection.app.state.sessions


def get_room_store(connection: HTTPConnection) -> RoomStore:
    return connection.app.state.rooms


def get_app_settings(connection: HTTPConnection) -> Settings:
    return connection.app.state.settings


def get_speech_translator(connection: HTTPConnection) -> SpeechTranslator | None:
    return connection.app.state.speech_translator


def get_speech_synthesizer(connection: HTTPConnection) -> SpeechSynthesizer | None:
    return connection.app.state.speech_synthesizer
