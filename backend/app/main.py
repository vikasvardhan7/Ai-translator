import logging
import re
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from app import __version__
from app.api import (
    access,
    account,
    assistant,
    keys,
    languages,
    meetings,
    rooms,
    sessions,
    trainer,
    voices,
)
from app.core.access import new_host_key
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.errors import install_error_handlers
from app.services.account_store import AccountStore, masked_email
from app.services.assistant.factory import build_meeting_assistant
from app.services.key_store import KeyStore
from app.services.limits import RateLimiter
from app.services.mailer import Mailer, build_mailer
from app.services.meeting_store import MeetingStore
from app.services.public_address import PublicAddress, find_cloudflared
from app.services.room_store import RoomStore
from app.services.session_store import SessionStore
from app.services.trainer.gemini import build_trainer
from app.services.trainer.library import ExerciseLibrary
from app.services.trainer.store import TrainerStore
from app.services.translation.factory import build_speech_translator
from app.services.voice.factory import build_speech_synthesizer

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
LOG_FORMAT = "%(levelname)s:     %(message)s"
SERVER_LOGGERS = ("uvicorn.error", "uvicorn.access")
SECRETS_IN_ADDRESSES = re.compile(r"(token=|/api/sessions/)[^&/\s\"']+")
BUILT_FOLDER = "assets"
BUILT_FILES_CACHE = "public, max-age=31536000, immutable"
PAGES_CACHE = "no-cache"

logger = logging.getLogger(__name__)


class WebsiteFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        built = Path(path).parts[:1] == (BUILT_FOLDER,) and response.status_code in (200, 304)
        response.headers["Cache-Control"] = BUILT_FILES_CACHE if built else PAGES_CACHE
        return response


def show_app_logs() -> None:
    app_logger = logging.getLogger("app")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(LOG_FORMAT))
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)


class HideSecrets(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                SECRETS_IN_ADDRESSES.sub(r"\1hidden", arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


def hide_secrets_in_server_logs() -> None:
    for name in SERVER_LOGGERS:
        server_logger = logging.getLogger(name)
        if not any(isinstance(f, HideSecrets) for f in server_logger.filters):
            server_logger.addFilter(HideSecrets())


def create_app(
    settings: Settings | None = None,
    frontend_dist: Path | None = None,
    host_key: str | None = None,
    meeting_store: MeetingStore | None = None,
    key_store: KeyStore | None = None,
    account_store: AccountStore | None = None,
    mailer: Mailer | None = None,
    trainer_store: TrainerStore | None = None,
    exercise_library: ExerciseLibrary | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info(
            "Host key: %s (needed only when the app is opened through a public link)",
            app.state.host_key,
        )
        if app.state.mailer is None:
            logger.warning(
                "Email codes are not set up, so nobody can create an account yet: add"
                " SMTP_USERNAME and SMTP_PASSWORD to backend/.env and start the backend again."
            )
        elif settings.smtp_username:
            logger.info(
                "Sign-up and reset codes are emailed from %s", masked_email(settings.smtp_username)
            )
        yield
        async with AsyncExitStack() as services:
            services.push_async_callback(app.state.public_address.aclose)
            services.push_async_callback(app.state.exercise_library.aclose)
            services.callback(app.state.meetings.close)
            services.callback(app.state.keys.close)
            services.callback(app.state.accounts.close)
            services.callback(app.state.trainer_store.close)
            for service in (
                app.state.speech_translator,
                app.state.speech_synthesizer,
                app.state.meeting_assistant,
                app.state.trainer_ai,
            ):
                if service is not None:
                    services.push_async_callback(service.aclose)

    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.host_key = host_key or new_host_key()
    app.state.sessions = SessionStore()
    app.state.rooms = RoomStore()
    app.state.meetings = meeting_store or MeetingStore(settings.meetings_file)
    app.state.keys = key_store or KeyStore(settings.keys_file)
    app.state.limiter = RateLimiter()
    app.state.accounts = account_store or AccountStore(settings.accounts_file)
    app.state.mailer = mailer or build_mailer(settings)
    app.state.trainer_store = trainer_store or TrainerStore(settings.trainer_file)
    app.state.trainer_ai = build_trainer(settings)
    app.state.exercise_library = exercise_library or ExerciseLibrary(
        settings.exercise_library_url, settings.exercise_images_url
    )
    app.state.forget_user = [app.state.trainer_store.forget]
    app.state.speech_translator = build_speech_translator(settings)
    app.state.speech_synthesizer = build_speech_synthesizer(settings)
    app.state.meeting_assistant = build_meeting_assistant(settings)
    cloudflared = find_cloudflared(settings.cloudflared_path)
    app.state.public_address = PublicAddress(
        [cloudflared] if cloudflared else None,
        app_served=frontend_dist is not None and frontend_dist.is_dir(),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(access.router)
    app.include_router(account.router)
    app.include_router(sessions.router)
    app.include_router(languages.router)
    app.include_router(rooms.router)
    app.include_router(meetings.router)
    app.include_router(keys.router)
    app.include_router(voices.router)
    app.include_router(assistant.router)
    app.include_router(trainer.router)
    if frontend_dist is not None and frontend_dist.is_dir():
        app.mount("/", WebsiteFiles(directory=frontend_dist, html=True), name="frontend")
    return app


show_app_logs()
hide_secrets_in_server_logs()
app = create_app(frontend_dist=FRONTEND_DIST)
