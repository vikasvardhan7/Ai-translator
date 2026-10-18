from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import sessions
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.services.session_store import SessionStore
from app.services.translation.factory import build_speech_translator


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        if app.state.speech_translator is not None:
            await app.state.speech_translator.aclose()

    app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.sessions = SessionStore()
    app.state.speech_translator = build_speech_translator(settings)

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
    return app


app = create_app()
