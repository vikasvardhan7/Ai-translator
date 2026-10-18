from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api import languages, rooms, sessions, voices
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.errors import install_error_handlers
from app.services.room_store import RoomStore
from app.services.session_store import SessionStore
from app.services.translation.factory import build_speech_translator
from app.services.voice.factory import build_speech_synthesizer

FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"


def create_app(settings: Settings | None = None, frontend_dist: Path | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        async with AsyncExitStack() as services:
            for service in (app.state.speech_translator, app.state.speech_synthesizer):
                if service is not None:
                    services.push_async_callback(service.aclose)

    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = SessionStore()
    app.state.rooms = RoomStore()
    app.state.speech_translator = build_speech_translator(settings)
    app.state.speech_synthesizer = build_speech_synthesizer(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(sessions.router)
    app.include_router(languages.router)
    app.include_router(rooms.router)
    app.include_router(voices.router)
    if frontend_dist is not None and frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    return app


app = create_app(frontend_dist=FRONTEND_DIST)
