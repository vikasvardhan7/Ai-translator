import asyncio
import base64
import contextlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError
from starlette.websockets import WebSocketState

from app.core.config import Settings
from app.core.errors import describe_errors
from app.models.protocol import ErrorCode, UtteranceEnd, UtteranceStart
from app.services.audio_ingestion.microphone import AudioRejected, MicrophoneInput
from app.services.audio_ingestion.segment import AudioSegment
from app.services.audio_ingestion.wav import encode_wav
from app.services.session_store import Session
from app.services.translation.base import SpeechTranslator, TranslationFailed
from app.services.voice.base import SpeechSynthesizer, VoiceFailed

logger = logging.getLogger(__name__)

MAX_TEXT_MESSAGE_BYTES = 64 * 1024
MAX_PENDING_UTTERANCES = 5
MAX_PENDING_VOICES = 5
STOP_GRACE_SECONDS = 5

CLOSE_NORMAL = 1000
CLOSE_INTERNAL_ERROR = 1011
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_UNKNOWN_SESSION = 4404


class _StopRequested(Exception):
    pass


@dataclass(frozen=True)
class _VoiceRequest:
    utterance_id: str
    listener_id: str
    text: str


class StreamSender:
    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket
        self._seq = 0
        self._lock = asyncio.Lock()

    async def send(self, message_type: str, **fields: Any) -> None:
        async with self._lock:
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


async def _drain(queue: asyncio.Queue, worker: asyncio.Task[None], timeout: float) -> None:
    drained = asyncio.create_task(queue.join())
    await asyncio.wait(
        {drained, worker}, timeout=max(0.0, timeout), return_when=asyncio.FIRST_COMPLETED
    )
    drained.cancel()


async def _cancel(worker: asyncio.Task[None]) -> None:
    worker.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await worker


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
    def __init__(
        self,
        websocket: WebSocket,
        session: Session,
        settings: Settings,
        translator: SpeechTranslator | None,
        synthesizer: SpeechSynthesizer | None,
    ) -> None:
        self._websocket = websocket
        self._session = session
        self._settings = settings
        self._translator = translator
        self._synthesizer = synthesizer
        self._sender = StreamSender(websocket)
        self._microphone = MicrophoneInput()
        self._pending: asyncio.Queue[AudioSegment] = asyncio.Queue(MAX_PENDING_UTTERANCES)
        self._in_flight: AudioSegment | None = None
        self._voices: asyncio.Queue[_VoiceRequest] = asyncio.Queue(MAX_PENDING_VOICES)
        self._speaking: _VoiceRequest | None = None

    async def run(self) -> None:
        translating = asyncio.create_task(self._translate_in_order())
        speaking = None
        if self._synthesizer is not None:
            speaking = asyncio.create_task(self._speak_in_order(self._synthesizer))
        workers = [task for task in (translating, speaking) if task is not None]
        try:
            stop_requested = await self._receive()
            if stop_requested:
                await self._finish_pending(translating, speaking)
        finally:
            for worker in workers:
                await _cancel(worker)
        if stop_requested:
            await self._websocket.close(code=CLOSE_NORMAL)

    async def _finish_pending(
        self, translating: asyncio.Task[None], speaking: asyncio.Task[None] | None
    ) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._settings.speech_timeout_seconds + STOP_GRACE_SECONDS
        await _drain(self._pending, translating, deadline - loop.time())
        await _cancel(translating)
        for segment in self._unfinished():
            await self._sender.error(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "The conversation ended before this sentence was translated.",
                utterance_id=segment.utterance_id,
            )
        if speaking is None:
            return
        await _drain(self._voices, speaking, deadline - loop.time())
        await _cancel(speaking)
        for request in self._unspoken():
            await self._sender.error(
                ErrorCode.VOICE_UNAVAILABLE,
                "The conversation ended before this voice was made.",
                utterance_id=request.utterance_id,
            )

    def _unspoken(self) -> list[_VoiceRequest]:
        unspoken = [self._speaking] if self._speaking is not None else []
        self._speaking = None
        while not self._voices.empty():
            unspoken.append(self._voices.get_nowait())
            self._voices.task_done()
        return unspoken

    def _unfinished(self) -> list[AudioSegment]:
        unfinished = [self._in_flight] if self._in_flight is not None else []
        self._in_flight = None
        while not self._pending.empty():
            unfinished.append(self._pending.get_nowait())
            self._pending.task_done()
        return unfinished

    async def _receive(self) -> bool:
        await self._sender.send(
            "session.ready",
            session_id=self._session.id,
            participants=[p.model_dump() for p in self._session.participants],
            server_voice=self._synthesizer is not None,
        )
        while True:
            message = await self._websocket.receive()
            if message["type"] == "websocket.disconnect":
                return False
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
                return True

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
        await self._sender.send(
            "utterance.received",
            utterance_id=segment.utterance_id,
            speaker_id=segment.speaker_id,
            duration_ms=segment.duration_ms,
        )
        try:
            self._pending.put_nowait(segment)
        except asyncio.QueueFull:
            await self._sender.error(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "Too many sentences are waiting to be translated. Please wait a moment.",
                utterance_id=segment.utterance_id,
                retryable=True,
            )

    async def _translate_in_order(self) -> None:
        while True:
            segment = await self._pending.get()
            self._in_flight = segment
            try:
                await self._translate(segment)
            except WebSocketDisconnect:
                return
            except Exception:
                if not self._connected():
                    return
                logger.exception("Translation failed for %s", segment.utterance_id)
                try:
                    await self._sender.error(
                        ErrorCode.INTERNAL_ERROR,
                        "Something went wrong while translating this sentence.",
                        utterance_id=segment.utterance_id,
                        retryable=True,
                    )
                except (WebSocketDisconnect, RuntimeError):
                    return
            finally:
                self._pending.task_done()
                del segment
            self._in_flight = None

    def _connected(self) -> bool:
        return (
            self._websocket.client_state == WebSocketState.CONNECTED
            and self._websocket.application_state == WebSocketState.CONNECTED
        )

    async def _translate(self, segment: AudioSegment) -> None:
        if self._translator is None:
            await self._sender.error(
                ErrorCode.PROVIDER_UNAVAILABLE,
                "Speech recognition is not set up. Add GEMINI_API_KEY and GEMINI_MODEL"
                " to backend/.env.",
                utterance_id=segment.utterance_id,
            )
            return

        listener = self._session.listener_for(segment.speaker_id)
        try:
            result = await self._translator.translate_speech(
                encode_wav(segment.pcm),
                "audio/wav",
                listener.preferred_language,
                segment.spoken_language,
            )
        except TranslationFailed as failure:
            await self._sender.error(
                failure.code,
                failure.message,
                utterance_id=segment.utterance_id,
                retryable=failure.retryable,
            )
            return

        await self._sender.send(
            "transcript.final",
            utterance_id=segment.utterance_id,
            speaker_id=segment.speaker_id,
            text=result.text,
            language=result.language,
            language_name=result.language_name,
        )
        await self._sender.send(
            "translation.final",
            utterance_id=segment.utterance_id,
            speaker_id=segment.speaker_id,
            listener_id=listener.id,
            target_language=listener.preferred_language,
            text=result.translation,
            translated=result.translated,
        )
        if result.translated and self._synthesizer is not None:
            await self._queue_voice(
                _VoiceRequest(segment.utterance_id, listener.id, result.translation)
            )

    async def _queue_voice(self, request: _VoiceRequest) -> None:
        try:
            self._voices.put_nowait(request)
        except asyncio.QueueFull:
            await self._sender.error(
                ErrorCode.VOICE_UNAVAILABLE,
                "Too many voices are waiting for this sentence.",
                utterance_id=request.utterance_id,
            )

    async def _speak_in_order(self, synthesizer: SpeechSynthesizer) -> None:
        while True:
            request = await self._voices.get()
            self._speaking = request
            try:
                await self._speak(synthesizer, request)
            except WebSocketDisconnect:
                return
            except Exception:
                if not self._connected():
                    return
                logger.exception("Voice failed for %s", request.utterance_id)
                try:
                    await self._sender.error(
                        ErrorCode.VOICE_UNAVAILABLE,
                        "The voice could not be made for this sentence.",
                        utterance_id=request.utterance_id,
                    )
                except (WebSocketDisconnect, RuntimeError):
                    return
            finally:
                self._voices.task_done()
                del request
            self._speaking = None

    async def _speak(self, synthesizer: SpeechSynthesizer, request: _VoiceRequest) -> None:
        try:
            audio = await synthesizer.synthesize(request.text)
        except VoiceFailed as failure:
            await self._sender.error(
                ErrorCode.VOICE_UNAVAILABLE, failure.message, utterance_id=request.utterance_id
            )
            return
        await self._sender.send(
            "tts.audio",
            utterance_id=request.utterance_id,
            listener_id=request.listener_id,
            format="wav",
            audio_base64=base64.b64encode(audio).decode("ascii"),
        )


async def handle_stream(
    websocket: WebSocket,
    take_session: Callable[[], Session | None],
    settings: Settings,
    translator: SpeechTranslator | None,
    synthesizer: SpeechSynthesizer | None,
) -> None:
    await websocket.accept()

    if not _origin_allowed(websocket, settings.frontend_origin):
        await websocket.close(code=CLOSE_ORIGIN_NOT_ALLOWED)
        return

    session = take_session()
    if session is None:
        await StreamSender(websocket).error(
            ErrorCode.UNKNOWN_SESSION,
            "This session does not exist, has expired or is already open. Start a new session.",
        )
        await websocket.close(code=CLOSE_UNKNOWN_SESSION)
        return

    handler = StreamHandler(websocket, session, settings, translator, synthesizer)
    try:
        await handler.run()
    except WebSocketDisconnect:
        return
    except Exception:
        logger.exception("Live channel failed for session %s", session.id)
        await handler.fail()
