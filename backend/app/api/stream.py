import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from app.core.config import Settings
from app.core.errors import describe_errors
from app.models.protocol import ErrorCode, UtteranceEnd, UtteranceStart
from app.services.audio_ingestion.microphone import AudioRejected, MicrophoneInput
from app.services.audio_ingestion.segment import AudioSegment
from app.services.audio_ingestion.wav import write_wav
from app.services.session_store import Session

logger = logging.getLogger(__name__)

MAX_TEXT_MESSAGE_BYTES = 64 * 1024

CLOSE_NORMAL = 1000
CLOSE_INTERNAL_ERROR = 1011
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_UNKNOWN_SESSION = 4404


class _StopRequested(Exception):
    pass


class StreamSender:
    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket
        self._seq = 0

    async def send(self, message_type: str, **fields: Any) -> None:
        self._seq += 1
        await self._websocket.send_json({"type": message_type, "seq": self._seq, **fields})

    async def error(
        self,
        code: ErrorCode,
        message: str,
        *,
        utterance_id: str | None = None,
        retryable: bool = False,
    ) -> None:
        await self.send(
            "error",
            code=code.value,
            message=message,
            retryable=retryable,
            utterance_id=utterance_id,
        )


def _origin_allowed(websocket: WebSocket, allowed_origin: str) -> bool:
    origin = websocket.headers.get("origin")
    return origin is None or origin == allowed_origin


def _parse(text: str) -> dict[str, Any] | str:
    if len(text.encode("utf-8")) > MAX_TEXT_MESSAGE_BYTES:
        return "Message is too large."
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return "Message is not valid JSON."
    if not isinstance(data, dict) or not isinstance(data.get("type"), str):
        return "Message must be a JSON object with a string 'type' field."
    return data


class StreamHandler:
    def __init__(self, websocket: WebSocket, session: Session, settings: Settings) -> None:
        self._websocket = websocket
        self._session = session
        self._settings = settings
        self._sender = StreamSender(websocket)
        self._microphone = MicrophoneInput()

    async def run(self) -> None:
        await self._sender.send(
            "session.ready",
            session_id=self._session.id,
            participants=[p.model_dump() for p in self._session.participants],
        )
        while True:
            message = await self._websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            try:
                if message.get("bytes") is not None:
                    self._microphone.add(message["bytes"])
                else:
                    await self._handle_text(message.get("text") or "")
            except AudioRejected as rejected:
                await self._sender.error(
                    rejected.code, rejected.message, utterance_id=rejected.utterance_id
                )
            except _StopRequested:
                await self._websocket.close(code=CLOSE_NORMAL)
                return

    async def fail(self) -> None:
        try:
            await self._sender.error(
                ErrorCode.INTERNAL_ERROR, "Something went wrong on the server.", retryable=True
            )
            await self._websocket.close(code=CLOSE_INTERNAL_ERROR)
        except (WebSocketDisconnect, RuntimeError):
            pass

    async def _handle_text(self, text: str) -> None:
        parsed = _parse(text)
        if isinstance(parsed, str):
            await self._sender.error(ErrorCode.INVALID_MESSAGE, parsed)
            return

        match parsed["type"]:
            case "ping":
                await self._sender.send("pong")
            case "session.stop":
                raise _StopRequested
            case "utterance.start":
                if start := await self._validate(UtteranceStart, parsed):
                    await self._start_utterance(start)
            case "utterance.end":
                if end := await self._validate(UtteranceEnd, parsed):
                    if segment := self._microphone.finish(end.utterance_id):
                        await self._utterance_received(segment)
            case unknown:
                await self._sender.error(
                    ErrorCode.INVALID_MESSAGE, f"Unknown message type '{unknown}'."
                )

    async def _validate[M: BaseModel](self, model: type[M], data: dict[str, Any]) -> M | None:
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            await self._sender.error(ErrorCode.INVALID_MESSAGE, describe_errors(exc.errors()))
            return None

    async def _start_utterance(self, start: UtteranceStart) -> None:
        replaced_id = self._microphone.start(
            start.utterance_id, start.speaker_id, start.spoken_language
        )
        if replaced_id:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "A new utterance started before this one ended, so it was discarded.",
                utterance_id=replaced_id,
            )

    async def _utterance_received(self, segment: AudioSegment) -> None:
        if self._settings.save_debug_audio:
            try:
                await asyncio.to_thread(write_wav, segment, self._settings.data_dir / "debug")
            except OSError:
                logger.exception("Could not save debug audio for %s", segment.utterance_id)
        await self._sender.send(
            "utterance.received",
            utterance_id=segment.utterance_id,
            speaker_id=segment.speaker_id,
            duration_ms=segment.duration_ms,
        )


async def handle_stream(websocket: WebSocket, session: Session | None, settings: Settings) -> None:
    await websocket.accept()

    if not _origin_allowed(websocket, settings.frontend_origin):
        await websocket.close(code=CLOSE_ORIGIN_NOT_ALLOWED)
        return

    if session is None:
        await StreamSender(websocket).error(
            ErrorCode.UNKNOWN_SESSION, "This session does not exist."
        )
        await websocket.close(code=CLOSE_UNKNOWN_SESSION)
        return

    handler = StreamHandler(websocket, session, settings)
    try:
        await handler.run()
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Live channel failed for session %s", session.id)
        await handler.fail()
