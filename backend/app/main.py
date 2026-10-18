from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import languages, sessions
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.services.session_store import SessionStore


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    app = FastAPI(title=settings.app_name, version=__version__)
    app.state.settings = settings
    app.state.sessions = SessionStore()

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

    app.include_router(languages.router)
    app.include_router(sessions.router)
    return app


app = create_app()
