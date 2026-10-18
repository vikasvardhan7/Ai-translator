import asyncio
import base64
import contextlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.config import Settings
from app.models.protocol import ErrorCode
from app.services.audio_ingestion.segment import AudioSegment
from app.services.audio_ingestion.speech_detector import FrameRejected, SpeechDetector
from app.services.audio_ingestion.wav import encode_wav
from app.services.session_store import Session
from app.services.translation.base import NothingRecognised, SpeechTranslator, TranslationFailed
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
    listener_ids: tuple[str, ...]
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
        self._detector = SpeechDetector()
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
            await self._voice_failed(request, "The conversation ended before this voice was made.")

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
                    await self._hear(message["bytes"])
                else:
                    await self._handle_text(message.get("text") or "")
            except _StopRequested:
                return True

    async def _hear(self, frame: bytes) -> None:
        try:
            segments = self._detector.add(frame)
        except FrameRejected:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "Audio frames must be 16-bit PCM and at most one second long.",
            )
            return
        for segment in segments:
            await self._utterance_received(segment)

    async def _end_sentence(self) -> None:
        if segment := self._detector.flush():
            await self._utterance_received(segment)

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
            case "audio.pause":
                await self._end_sentence()
            case "session.stop":
                await self._end_sentence()
                raise _StopRequested
            case unknown:
                await self._sender.error(
                    ErrorCode.INVALID_MESSAGE, f"Unknown message type '{unknown}'."
                )

    async def _utterance_received(self, segment: AudioSegment) -> None:
        await self._sender.send(
            "utterance.received",
            utterance_id=segment.utterance_id,
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

        participants = self._session.participants
        targets = list(dict.fromkeys(p.preferred_language for p in participants))
        try:
            result = await self._translator.translate_speech(
                encode_wav(segment.pcm), "audio/wav", targets
            )
        except NothingRecognised:
            await self._sender.send("utterance.ignored", utterance_id=segment.utterance_id)
            return
        except TranslationFailed as failure:
            await self._sender.error(
                failure.code,
                failure.message,
                utterance_id=segment.utterance_id,
                retryable=failure.retryable,
            )
            return

        understood = [
            p for p in participants if result.for_language(p.preferred_language).same_language
        ]
        speaker_id = understood[0].id if len(understood) == 1 else None
        await self._sender.send(
            "transcript.final",
            utterance_id=segment.utterance_id,
            speaker_id=speaker_id,
            text=result.text,
            language=result.language,
            language_name=result.language_name,
        )
        voices: dict[str, list[str]] = {}
        for listener in participants:
            if listener in understood:
                continue
            text = result.for_language(listener.preferred_language).text
            await self._sender.send(
                "translation.final",
                utterance_id=segment.utterance_id,
                speaker_id=speaker_id,
                listener_id=listener.id,
                target_language=listener.preferred_language,
                text=text,
            )
            voices.setdefault(text, []).append(listener.id)
        if self._synthesizer is None:
            return
        for text, listener_ids in voices.items():
            await self._queue_voice(_VoiceRequest(segment.utterance_id, tuple(listener_ids), text))

    async def _queue_voice(self, request: _VoiceRequest) -> None:
        try:
            self._voices.put_nowait(request)
        except asyncio.QueueFull:
            await self._voice_failed(request, "Too many voices are waiting for this sentence.")

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
                    await self._voice_failed(
                        request, "The voice could not be made for this sentence."
                    )
                except (WebSocketDisconnect, RuntimeError):
                    return
            finally:
                self._voices.task_done()
                del request
            self._speaking = None

    async def _voice_failed(self, request: _VoiceRequest, message: str) -> None:
        for listener_id in request.listener_ids:
            await self._sender.send(
                "error",
                code=ErrorCode.VOICE_UNAVAILABLE.value,
                message=message,
                retryable=False,
                utterance_id=request.utterance_id,
                listener_id=listener_id,
            )

    async def _speak(self, synthesizer: SpeechSynthesizer, request: _VoiceRequest) -> None:
        try:
            audio = await synthesizer.synthesize(request.text)
        except VoiceFailed as failure:
            await self._voice_failed(request, failure.message)
            return
        encoded = base64.b64encode(audio).decode("ascii")
        del audio
        for listener_id in request.listener_ids:
            await self._sender.send(
                "tts.audio",
                utterance_id=request.utterance_id,
                listener_id=listener_id,
                format="wav",
                audio_base64=encoded,
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
