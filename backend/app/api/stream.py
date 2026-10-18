import asyncio
import base64
import contextlib
import json
import logging
import re
from abc import ABC, abstractmethod
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.config import Settings
from app.core.languages import invalid_language_message, language_code
from app.core.text import MAX_RECENT_TRANSLATIONS, is_echo
from app.models.protocol import ErrorCode
from app.services.audio_ingestion.segment import AudioSegment
from app.services.audio_ingestion.speech_detector import FrameRejected, SpeechDetector
from app.services.audio_ingestion.wav import encode_wav
from app.services.room_store import Device, Room, RoomStore
from app.services.session_store import Session
from app.services.translation.base import NothingRecognised, SpeechTranslator, TranslationFailed
from app.services.voice.base import SpeechSynthesizer, VoiceFailed

logger = logging.getLogger(__name__)

MAX_TEXT_MESSAGE_BYTES = 64 * 1024
MAX_PENDING_UTTERANCES = 5
MAX_PENDING_VOICES = 5
STOP_GRACE_SECONDS = 5
ECHO_SECONDS = 12
VOICE_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")

CLOSE_NORMAL = 1000
CLOSE_INTERNAL_ERROR = 1011
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_FORBIDDEN = 4401
CLOSE_UNKNOWN_SESSION = 4404
CLOSE_NOT_JOINED = 4409

BROADCAST_TYPES = frozenset(
    {
        "utterance.received",
        "transcript.final",
        "translation.final",
        "utterance.ignored",
        "speech.activity",
        "participants.updated",
    }
)


class _StopRequested(Exception):
    pass


@dataclass(frozen=True)
class _VoiceRequest:
    utterance_id: str
    listener_ids: tuple[str, ...]
    text: str
    voice: str | None


class Sender(ABC):
    @abstractmethod
    async def send(self, message_type: str, **fields: Any) -> None: ...

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


class StreamSender(Sender):
    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket
        self._seq = 0
        self._lock = asyncio.Lock()

    async def send(self, message_type: str, **fields: Any) -> None:
        async with self._lock:
            self._seq += 1
            await self._websocket.send_json({"type": message_type, "seq": self._seq, **fields})


async def send_quietly(device: Device, message_type: str, **fields: Any) -> None:
    with contextlib.suppress(Exception):
        await device.send(message_type, **fields)


class RoomSender(Sender):
    def __init__(self, room: Room, participant_id: str) -> None:
        self._devices = room.devices
        self._own_id = participant_id

    async def send(self, message_type: str, **fields: Any) -> None:
        for device_id in self._recipients(message_type, fields):
            device = self._devices.get(device_id)
            if device is None:
                continue
            if device_id == self._own_id:
                await device.send(message_type, **fields)
            else:
                await send_quietly(device, message_type, **fields)

    def _recipients(self, message_type: str, fields: dict[str, Any]) -> list[str]:
        is_error = message_type == "error"
        if message_type == "tts.audio" or (
            is_error and fields.get("code") == ErrorCode.VOICE_UNAVAILABLE
        ):
            return [fields["listener_id"]]
        if message_type in BROADCAST_TYPES or (is_error and fields.get("utterance_id")):
            return list(self._devices)
        return [self._own_id]


@dataclass(frozen=True)
class Seat:
    room: Room
    participant_id: str


async def _drain(queue: asyncio.Queue, worker: asyncio.Task[None], timeout: float) -> None:
    drained = asyncio.create_task(queue.join())
    try:
        await asyncio.wait(
            {drained, worker}, timeout=max(0.0, timeout), return_when=asyncio.FIRST_COMPLETED
        )
    finally:
        drained.cancel()


async def _cancel(worker: asyncio.Task[None]) -> None:
    worker.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await worker


def _now() -> float:
    return asyncio.get_running_loop().time()


def _detectors_for(session: Session, you: str | None) -> dict[str | None, SpeechDetector]:
    if session.mode == "call":
        return {p.id: SpeechDetector(p.id) for p in session.participants}
    return {you: SpeechDetector(you)}


def _own_origin(websocket: WebSocket) -> str:
    forwarded = websocket.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    secure = forwarded == "https" or websocket.url.scheme in ("https", "wss")
    return f"{'https' if secure else 'http'}://{websocket.headers.get('host', '')}"


def _origin_allowed(websocket: WebSocket, allowed_origin: str) -> bool:
    origin = websocket.headers.get("origin")
    return origin is None or origin in (allowed_origin, _own_origin(websocket))


def _is_voice_choice(voice: object) -> bool:
    return voice is None or (isinstance(voice, str) and VOICE_NAME.fullmatch(voice) is not None)


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
        seat: Seat | None = None,
    ) -> None:
        self._websocket = websocket
        self._session = session
        self._settings = settings
        self._translator = translator
        self._synthesizer = synthesizer
        self._you = seat.participant_id if seat else None
        self._sender: Sender = (
            RoomSender(seat.room, seat.participant_id) if seat else StreamSender(websocket)
        )
        self._detectors = _detectors_for(session, self._you)
        self._pending: asyncio.Queue[AudioSegment] = asyncio.Queue(MAX_PENDING_UTTERANCES)
        self._in_flight: AudioSegment | None = None
        self._voices: asyncio.Queue[_VoiceRequest] = asyncio.Queue(MAX_PENDING_VOICES)
        self._speaking: _VoiceRequest | None = None
        self._server_voice_for = (
            seat.room.server_voice_for if seat else {p.id for p in session.participants}
        )
        self._voice_for: dict[str, str] = seat.room.voice_for if seat else {}
        self._recent_translations: deque[tuple[float, str]] = (
            seat.room.recent_translations if seat else deque(maxlen=MAX_RECENT_TRANSLATIONS)
        )

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
        if stop_requested and self.connected():
            await self._websocket.close(code=CLOSE_NORMAL)

    async def _finish_pending(
        self, translating: asyncio.Task[None], speaking: asyncio.Task[None] | None
    ) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._settings.speech_timeout_seconds + STOP_GRACE_SECONDS
        await _drain(self._pending, translating, deadline - loop.time())
        await _cancel(translating)
        if not self.connected():
            return
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
        if not self.connected():
            return
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
        you = {"you": self._you} if self._you else {}
        await self._sender.send(
            "session.ready",
            session_id=self._session.id,
            participants=[p.model_dump() for p in self._session.participants],
            server_voice=self._synthesizer is not None,
            mode=self._session.mode,
            **you,
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
        source = self._you
        if self._session.mode == "call":
            source = chr(frame[0]) if len(frame) > 1 else None
            if source not in self._detectors:
                await self._sender.error(
                    ErrorCode.INVALID_MESSAGE,
                    "In a call, each audio frame is the byte 'A' (this device's microphone)"
                    " or 'B' (the call) followed by audio.",
                )
                return
            frame = frame[1:]
        detector = self._detectors[source]
        was_speaking = detector.in_sentence
        try:
            segments = detector.add(frame)
        except FrameRejected:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "Audio frames must be 16-bit PCM and at most one second long.",
            )
            return
        for segment in segments:
            await self._utterance_received(segment)
        if detector.in_sentence != was_speaking:
            await self._sender.send(
                "speech.activity", speaker_id=source, active=detector.in_sentence
            )

    async def _end_sentence(self, source: object = None) -> None:
        if self._session.mode == "call" and source is not None:
            if not isinstance(source, str) or source not in self._detectors:
                await self._sender.error(
                    ErrorCode.INVALID_MESSAGE, "participant_id must be 'A' or 'B'."
                )
                return
            detectors = {source: self._detectors[source]}
        else:
            detectors = self._detectors
        for speaker_id, detector in detectors.items():
            was_speaking = detector.in_sentence
            if segment := detector.flush():
                await self._utterance_received(segment)
            if was_speaking:
                await self._sender.send("speech.activity", speaker_id=speaker_id, active=False)

    async def _set_voice(self, listener_id: object, settings: dict[str, Any]) -> None:
        known = {p.id for p in self._session.participants}
        server_voice = settings.get("server_voice")
        voice = settings.get("voice")
        if not (isinstance(listener_id, str) and listener_id in known) or not isinstance(
            server_voice, bool
        ):
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "voice.settings needs listener_id 'A' or 'B' and server_voice true or false.",
            )
        elif not _is_voice_choice(voice):
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "voice must be a voice name of 1 to 64 letters, digits, '_' or '-',"
                " or null for the automatic voice.",
            )
        elif self._session.mode == "call" and not server_voice:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "In a call the server voice is always on: the other person can only hear it.",
            )
        else:
            if server_voice:
                self._server_voice_for.add(listener_id)
            else:
                self._server_voice_for.discard(listener_id)
            if voice is not None:
                self._voice_for[listener_id] = voice
            elif "voice" in settings:
                self._voice_for.pop(listener_id, None)

    async def _set_language(self, participant_id: object, language: object) -> None:
        participants = self._session.participants
        person = next((p for p in participants if p.id == participant_id), None)
        code = language_code(language) if isinstance(language, str) else None
        if person is None:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE, "language.set needs participant_id 'A' or 'B'."
            )
        elif code is None:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                invalid_language_message(language)
                if isinstance(language, str)
                else "language.set needs a language code such as te, hi, en or yue.",
            )
        elif any(p.preferred_language == code for p in participants if p is not person):
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                f"You both chose {code}. Pick a different language for one of you.",
            )
        else:
            person.preferred_language = code
            await self._sender.send(
                "participants.updated", participants=[p.model_dump() for p in participants]
            )

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
                await self._end_sentence(parsed.get("participant_id"))
            case "voice.settings":
                await self._set_voice(self._you or parsed.get("listener_id"), parsed)
            case "language.set":
                await self._set_language(
                    self._you or parsed.get("participant_id"), parsed.get("language")
                )
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
                if not self.connected():
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

    def connected(self) -> bool:
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

        participants = [p.model_copy() for p in self._session.participants]
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
        if self._is_echo(result.text):
            await self._sender.send("utterance.ignored", utterance_id=segment.utterance_id)
            return

        speaker_id = segment.speaker_id
        if speaker_id is None:
            understood = [
                p for p in participants if result.for_language(p.preferred_language).same_language
            ]
            speaker_id = understood[0].id if len(understood) == 1 else None
            listeners = [p for p in participants if p not in understood]
        else:
            listeners = [p for p in participants if p.id != speaker_id]
        await self._sender.send(
            "transcript.final",
            utterance_id=segment.utterance_id,
            speaker_id=speaker_id,
            text=result.text,
            language=result.language,
            language_name=result.language_name,
        )
        voices: dict[tuple[str, str | None], list[str]] = {}
        for listener in listeners:
            text = result.for_language(listener.preferred_language).text
            await self._sender.send(
                "translation.final",
                utterance_id=segment.utterance_id,
                speaker_id=speaker_id,
                listener_id=listener.id,
                target_language=listener.preferred_language,
                text=text,
            )
            self._recent_translations.append((_now(), text))
            if listener.id in self._server_voice_for:
                voices.setdefault((text, self._voice_for.get(listener.id)), []).append(listener.id)
        if self._synthesizer is None:
            return
        for (text, voice), listener_ids in voices.items():
            await self._queue_voice(
                _VoiceRequest(segment.utterance_id, tuple(listener_ids), text, voice)
            )

    def _is_echo(self, transcript: str) -> bool:
        since = _now() - ECHO_SECONDS
        return any(
            is_echo(transcript, text) for sent, text in self._recent_translations if sent > since
        )

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
                if not self.connected():
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
            audio = await synthesizer.synthesize(request.text, request.voice)
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


async def _accept(websocket: WebSocket, settings: Settings) -> bool:
    await websocket.accept()
    if _origin_allowed(websocket, settings.frontend_origin):
        return True
    await websocket.close(code=CLOSE_ORIGIN_NOT_ALLOWED)
    return False


async def _refuse(websocket: WebSocket, code: ErrorCode, message: str, close_code: int) -> None:
    await StreamSender(websocket).error(code, message)
    await websocket.close(code=close_code)


async def _run(handler: StreamHandler, session_id: str) -> None:
    try:
        await handler.run()
    except WebSocketDisconnect:
        return
    except Exception:
        if not handler.connected():
            return
        logger.exception("Live channel failed for session %s", session_id)
        await handler.fail()


async def handle_stream(
    websocket: WebSocket,
    take_session: Callable[[], Session | None],
    settings: Settings,
    translator: SpeechTranslator | None,
    synthesizer: SpeechSynthesizer | None,
) -> None:
    if not await _accept(websocket, settings):
        return

    session = take_session()
    if session is None:
        await _refuse(
            websocket,
            ErrorCode.UNKNOWN_SESSION,
            "This session does not exist, has expired or is already open. Start a new session.",
            CLOSE_UNKNOWN_SESSION,
        )
        return

    await _run(StreamHandler(websocket, session, settings, translator, synthesizer), session.id)


async def handle_room_stream(
    websocket: WebSocket,
    rooms: RoomStore,
    room_id: str,
    token: str,
    settings: Settings,
    translator: SpeechTranslator | None,
    synthesizer: SpeechSynthesizer | None,
) -> None:
    if not await _accept(websocket, settings):
        return

    room = rooms.get(room_id)
    if room is None:
        await _refuse(
            websocket,
            ErrorCode.UNKNOWN_SESSION,
            "This conversation does not exist or has expired. Ask for a new invite link.",
            CLOSE_UNKNOWN_SESSION,
        )
        return
    participant_id = room.participant_for(token)
    if participant_id is None:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return
    if room.guest is None:
        await _refuse(
            websocket,
            ErrorCode.NOT_JOINED,
            "The other person has not joined yet.",
            CLOSE_NOT_JOINED,
        )
        return
    if not rooms.connect(room, participant_id, StreamSender(websocket)):
        await _refuse(
            websocket,
            ErrorCode.UNKNOWN_SESSION,
            "This conversation is already open on another device.",
            CLOSE_UNKNOWN_SESSION,
        )
        return

    seat = Seat(room, participant_id)
    try:
        await _run(
            StreamHandler(websocket, room.session(), settings, translator, synthesizer, seat),
            room.id,
        )
    finally:
        rooms.disconnect(room, participant_id)
        for device in list(room.devices.values()):
            await send_quietly(device, "peer.left", participant_id=participant_id)
