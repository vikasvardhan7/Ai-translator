import json
from enum import StrEnum
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from app.services.session_store import Session

MAX_TEXT_MESSAGE_BYTES = 64 * 1024

CLOSE_NORMAL = 1000
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_UNKNOWN_SESSION = 4404


class ErrorCode(StrEnum):
    INVALID_MESSAGE = "invalid_message"
    UNKNOWN_SESSION = "unknown_session"
    NO_ACTIVE_UTTERANCE = "no_active_utterance"


class StreamSender:
    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket
        self._seq = 0

    async def send(self, message_type: str, **fields: Any) -> None:
        self._seq += 1
        await self._websocket.send_json({"type": message_type, "seq": self._seq, **fields})

    async def error(self, code: ErrorCode, message: str, *, retryable: bool = False) -> None:
        await self.send(
            "error", code=code.value, message=message, retryable=retryable, utterance_id=None
        )


def _origin_allowed(websocket: WebSocket, allowed_origin: str) -> bool:
    # Browsers always send Origin; non-browser clients may omit it.
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


async def handle_stream(websocket: WebSocket, session: Session | None, allowed_origin: str) -> None:
    await websocket.accept()

    if not _origin_allowed(websocket, allowed_origin):
        await websocket.close(code=CLOSE_ORIGIN_NOT_ALLOWED)
        return

    sender = StreamSender(websocket)

    if session is None:
        await sender.error(ErrorCode.UNKNOWN_SESSION, "This session does not exist.")
        await websocket.close(code=CLOSE_UNKNOWN_SESSION)
        return

    await sender.send(
        "session.ready",
        session_id=session.id,
        participants=[p.model_dump() for p in session.participants],
    )

    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return

            if message.get("bytes") is not None:
                await sender.error(
                    ErrorCode.NO_ACTIVE_UTTERANCE,
                    "Audio was received without an open utterance.",
                )
                continue

            parsed = _parse(message.get("text") or "")
            if isinstance(parsed, str):
                await sender.error(ErrorCode.INVALID_MESSAGE, parsed)
                continue

            message_type = parsed["type"]
            if message_type == "ping":
                await sender.send("pong")
            elif message_type == "session.stop":
                await websocket.close(code=CLOSE_NORMAL)
                return
            else:
                await sender.error(
                    ErrorCode.INVALID_MESSAGE, f"Unknown message type '{message_type}'."
                )
    except WebSocketDisconnect:
        return
