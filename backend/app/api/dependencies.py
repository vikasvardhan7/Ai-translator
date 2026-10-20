import hashlib

from fastapi import HTTPException, status
from starlette.requests import HTTPConnection

from app.core.access import (
    API_KEY_HEADER,
    MEETING_ID_HEADER,
    MEETING_TOKEN_HEADER,
    ROOM_ID_HEADER,
    ROOM_TOKEN_HEADER,
    SESSION_COOKIE,
    is_host,
)
from app.core.config import Settings
from app.services.account_store import AccountStore, User
from app.services.assistant.base import MeetingAssistant
from app.services.key_store import ApiKey, KeyStore
from app.services.limits import Allowance, Budget, RateLimiter, TooManyRequests
from app.services.mailer import Mailer
from app.services.meeting_store import MeetingStore
from app.services.public_address import PublicAddress
from app.services.room_store import RoomStore
from app.services.session_store import SessionStore
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer

HOST_KEY_NEEDED = (
    "Sign in first. Through a public link without an account, this needs the host key shown in"
    " the backend window."
)
SIGN_IN_NEEDED = "Sign in first."
KEY_NOT_VALID = "This API key is not valid or was revoked. Ask the owner of the app for a new one."
OWNER_NEEDED = (
    "Only the person running the app can do this: open it on that computer or use the host key."
)


def get_session_store(connection: HTTPConnection) -> SessionStore:
    return connection.app.state.sessions


def get_room_store(connection: HTTPConnection) -> RoomStore:
    return connection.app.state.rooms


def get_meeting_store(connection: HTTPConnection) -> MeetingStore:
    return connection.app.state.meetings


def get_app_settings(connection: HTTPConnection) -> Settings:
    return connection.app.state.settings


def get_public_address(connection: HTTPConnection) -> PublicAddress:
    return connection.app.state.public_address


def get_speech_translator(connection: HTTPConnection) -> SpeechTranslator | None:
    return connection.app.state.speech_translator


def get_speech_synthesizer(connection: HTTPConnection) -> SpeechSynthesizer | None:
    return connection.app.state.speech_synthesizer


def get_meeting_assistant(connection: HTTPConnection) -> MeetingAssistant | None:
    return connection.app.state.meeting_assistant


def get_account_store(connection: HTTPConnection) -> AccountStore:
    return connection.app.state.accounts


def get_mailer(connection: HTTPConnection) -> Mailer | None:
    return connection.app.state.mailer


def signed_in_user(connection: HTTPConnection) -> User | None:
    if not hasattr(connection.state, "user"):
        token = connection.cookies.get(SESSION_COOKIE, "")
        connection.state.user = get_account_store(connection).session_user(token)
    return connection.state.user


def require_user(connection: HTTPConnection) -> User:
    user = signed_in_user(connection)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, SIGN_IN_NEEDED)
    return user


def client_address(connection: HTTPConnection) -> str:
    forwarded = (
        connection.headers.get("cf-connecting-ip")
        or connection.headers.get("x-forwarded-for", "").split(",")[0].strip()
    )
    if forwarded:
        return forwarded
    return connection.client.host if connection.client else "unknown"


def get_key_store(connection: HTTPConnection) -> KeyStore:
    return connection.app.state.keys


def get_limiter(connection: HTTPConnection) -> RateLimiter:
    return connection.app.state.limiter


def is_owner(connection: HTTPConnection) -> bool:
    state = connection.app.state
    return is_host(connection, state.host_key, key_everywhere=state.settings.host_key_everywhere)


def api_key_of(connection: HTTPConnection) -> ApiKey | None:
    secret = connection.headers.get(API_KEY_HEADER, "")
    return get_key_store(connection).find(secret) if secret else None


def is_host_request(connection: HTTPConnection) -> bool:
    if API_KEY_HEADER in connection.headers:
        return api_key_of(connection) is not None
    return is_owner(connection) or signed_in_user(connection) is not None


def key_identity(key: ApiKey) -> str:
    return f"key:{key.id}"


def _guest_token(connection: HTTPConnection) -> str | None:
    room = get_room_store(connection).get(connection.headers.get(ROOM_ID_HEADER, ""))
    token = connection.headers.get(ROOM_TOKEN_HEADER, "")
    if room is not None and token and room.allows(token):
        return token
    meeting = get_meeting_store(connection).get(connection.headers.get(MEETING_ID_HEADER, ""))
    meeting_token = connection.headers.get(MEETING_TOKEN_HEADER, "")
    return meeting_token if meeting is not None and meeting.allows(meeting_token) else None


def use_allowance(
    connection: HTTPConnection, identity: str, allowance: Allowance, who: str
) -> None:
    try:
        get_limiter(connection).use(identity, allowance)
    except TooManyRequests as exc:
        message = (
            f"{who} used up its {allowance.per_day} requests for today. It starts again at"
            " midnight UTC."
            if exc.daily
            else f"{who} sent too many requests at once. Wait {exc.wait_seconds} s and try again."
        )
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            message,
            headers={"Retry-After": str(exc.wait_seconds)},
        ) from exc


def key_allowance(connection: HTTPConnection, key: ApiKey) -> Allowance:
    return Allowance(get_app_settings(connection).key_requests_per_minute, key.daily_limit)


def user_identity(user: User) -> str:
    return f"user:{user.id}"


def user_allowance(connection: HTTPConnection) -> Allowance:
    settings = get_app_settings(connection)
    return Allowance(settings.user_requests_per_minute, settings.user_requests_per_day)


def request_budget(connection: HTTPConnection) -> Budget | None:
    key = api_key_of(connection)
    if key is not None:
        return Budget(key_identity(key), key_allowance(connection, key))
    if is_owner(connection):
        return None
    user = signed_in_user(connection)
    return Budget(user_identity(user), user_allowance(connection)) if user else None


def _check_user(connection: HTTPConnection) -> bool:
    user = signed_in_user(connection)
    if user is None:
        return False
    use_allowance(connection, user_identity(user), user_allowance(connection), "This account")
    return True


def _check_key(connection: HTTPConnection) -> bool:
    if API_KEY_HEADER not in connection.headers:
        return False
    key = api_key_of(connection)
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, KEY_NOT_VALID)
    use_allowance(connection, key_identity(key), key_allowance(connection, key), "This API key")
    get_key_store(connection).touch(key)
    return True


def require_owner(connection: HTTPConnection) -> None:
    if API_KEY_HEADER in connection.headers or not is_owner(connection):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, OWNER_NEEDED)


def require_member(connection: HTTPConnection) -> str | None:
    if API_KEY_HEADER in connection.headers:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, OWNER_NEEDED)
    user = signed_in_user(connection)
    if user is not None:
        return user.id
    if is_owner(connection):
        return None
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, HOST_KEY_NEEDED)


def require_host(connection: HTTPConnection) -> None:
    if _check_key(connection) or is_owner(connection) or _check_user(connection):
        return
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, HOST_KEY_NEEDED)


def require_host_or_guest(connection: HTTPConnection) -> None:
    if _check_key(connection) or is_owner(connection) or _check_user(connection):
        return
    token = _guest_token(connection)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, HOST_KEY_NEEDED)
    settings = get_app_settings(connection)
    allowance = Allowance(settings.guest_requests_per_minute, settings.guest_requests_per_day)
    identity = "guest:" + hashlib.sha256(token.encode()).hexdigest()[:24]
    use_allowance(connection, identity, allowance, "This invitation")
