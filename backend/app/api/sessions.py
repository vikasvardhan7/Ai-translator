from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, status

from app.api.dependencies import get_app_settings, get_session_store
from app.api.stream import handle_stream
from app.core.config import Settings
from app.models.session import SessionCreate, SessionOut
from app.services.session_store import SessionStore

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

Store = Annotated[SessionStore, Depends(get_session_store)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreate, store: Store) -> SessionOut:
    session = store.create(body.participants)
    return SessionOut(
        session_id=session.id,
        participants=session.participants,
        created_at=session.created_at,
    )


@router.websocket("/{session_id}/stream")
async def session_stream(
    websocket: WebSocket, session_id: str, store: Store, settings: AppSettings
) -> None:
    await handle_stream(websocket, store.get(session_id), allowed_origin=settings.frontend_origin)
