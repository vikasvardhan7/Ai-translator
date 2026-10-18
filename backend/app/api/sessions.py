from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, WebSocket, status

from app.api.dependencies import (
    get_app_settings,
    get_session_store,
    get_speech_synthesizer,
    get_speech_translator,
)
from app.api.stream import handle_stream
from app.core.config import Settings
from app.models.session import SessionCreate, SessionOut
from app.services.session_store import SessionLimitReached, SessionStore
from app.services.translation.base import SpeechTranslator
from app.services.voice.base import SpeechSynthesizer

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

Store = Annotated[SessionStore, Depends(get_session_store)]
AppSettings = Annotated[Settings, Depends(get_app_settings)]
Translator = Annotated[SpeechTranslator | None, Depends(get_speech_translator)]
Synthesizer = Annotated[SpeechSynthesizer | None, Depends(get_speech_synthesizer)]


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(body: SessionCreate, store: Store) -> SessionOut:
    try:
        session = store.create(body.participants)
    except SessionLimitReached as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Too many sessions are waiting to be opened. Try again in a few minutes.",
        ) from exc
    return SessionOut(
        session_id=session.id,
        participants=session.participants,
        created_at=session.created_at,
    )


@router.websocket("/{session_id}/stream")
async def session_stream(
    websocket: WebSocket,
    session_id: str,
    store: Store,
    settings: AppSettings,
    translator: Translator,
    synthesizer: Synthesizer,
) -> None:
    await handle_stream(
        websocket, lambda: store.take(session_id), settings, translator, synthesizer
    )
