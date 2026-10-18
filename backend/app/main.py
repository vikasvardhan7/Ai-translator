from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import sessions
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.services.session_store import SessionStore
from app.services.translation.factory import build_speech_translator
from app.services.voice.factory import build_speech_synthesizer


def create_app(settings: Settings | None = None) -> FastAPI:
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
    return app


app = create_app()
