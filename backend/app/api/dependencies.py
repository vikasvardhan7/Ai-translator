from starlette.requests import HTTPConnection

from app.core.config import Settings
from app.services.session_store import SessionStore


def get_session_store(connection: HTTPConnection) -> SessionStore:
    return connection.app.state.sessions


def get_app_settings(connection: HTTPConnection) -> Settings:
    return connection.app.state.settings
