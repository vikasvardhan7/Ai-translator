import asyncio
import base64
import contextlib
import json
import logging
import re
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.access import is_trusted_host, own_origin
from app.core.config import Settings
from app.core.languages import invalid_language_message, language_code
from app.core.text import CONTEXT_SENTENCES, MAX_REMEMBERED, PlayedVoice, is_echo, is_overheard
from app.models.protocol import ErrorCode
from app.services.audio_ingestion.segment import AudioSegment
from app.services.audio_ingestion.speech_detector import FrameRejected, SpeechDetector
from app.services.audio_ingestion.wav import encode_wav
from app.services.limits import RateLimiter, TooManyRequests
from app.services.room_store import HOST_ID, Room, RoomStore
from app.services.session_store import Device, Session, SessionStore
from app.services.translation.base import NothingRecognised, SpeechTranslator, TranslationFailed
from app.services.voice.base import SpeechSynthesizer, VoiceFailed
from app.services.voice_prints import VoiceBook, voice_print

logger = logging.getLogger(__name__)

MAX_TEXT_MESSAGE_BYTES = 64 * 1024
MAX_PENDING_UTTERANCES = 5
MAX_PENDING_VOICES = 5
MAX_QUEUED_FOR_PEER = 200
MAX_PLAYED_SECONDS = 120
MAX_REMEMBERED_TRANSLATIONS = 40
STOP_GRACE_SECONDS = 5
QUIET_LIMIT_SECONDS = 45
ECHO_MARGIN_SECONDS = 0.25
VOICE_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
CALL_SOURCES = ("A", "B")
YOU = "A"
MEETING_VOICES = ("1", "2", "3", "4", "5", "6")
MAX_LIVE_WORDS = 500

CLOSE_NORMAL = 1000
CLOSE_INTERNAL_ERROR = 1011
CLOSE_ORIGIN_NOT_ALLOWED = 4403
CLOSE_FORBIDDEN = 4401
CLOSE_QUIET = 4408
CLOSE_UNKNOWN_SESSION = 4404
CLOSE_REPLACED = 4410

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
    ended_at: float


@dataclass(frozen=True)
class _Heard:
    start: float
    end: float
    text: str
    utterance_id: str

    def overlaps(self, start: float, end: float) -> bool:
        return self.start < end and start < self.end


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
        self._posted: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue(MAX_QUEUED_FOR_PEER)
        self._poster: asyncio.Task[None] | None = None

    async def send(self, message_type: str, **fields: Any) -> None:
        async with self._lock:
            self._seq += 1
            await self._websocket.send_json({"type": message_type, "seq": self._seq, **fields})

    def post(self, message_type: str, **fields: Any) -> None:
        if self._poster is not None and self._poster.done():
            return
        with contextlib.suppress(asyncio.QueueFull):
            self._posted.put_nowait((message_type, fields))
        if self._poster is None:
            self._poster = asyncio.create_task(self._deliver_posted())

    async def _deliver_posted(self) -> None:
        while True:
            message_type, fields = await self._posted.get()
            try:
                await self.send(message_type, **fields)
            except Exception:
                return

    async def stop_posting(self) -> None:
        if self._poster is not None:
            await _cancel(self._poster)

    async def close(self, code: int) -> None:
        with contextlib.suppress(Exception):
            await self._websocket.close(code=code)


class RoomSender(Sender):
    def __init__(self, room: Room, participant_id: str, device: Device) -> None:
        self._devices = room.devices
        self._own_id = participant_id
        self._own = device

    async def send(self, message_type: str, **fields: Any) -> None:
        for device_id in self._recipients(message_type, fields):
            if device_id == self._own_id:
                await self._own.send(message_type, **fields)
            elif (device := self._devices.get(device_id)) is not None:
                device.post(message_type, **fields)

    def _recipients(self, message_type: str, fields: dict[str, Any]) -> list[str]:
        is_error = message_type == "error"
        if message_type == "tts.audio" or (
            is_error and fields.get("code") == ErrorCode.VOICE_UNAVAILABLE
        ):
            return [fields["listener_id"]]
        if message_type in BROADCAST_TYPES or (is_error and fields.get("utterance_id")):
            return [self._own_id, *(d for d in self._devices if d != self._own_id)]
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


_closing: set[asyncio.Task[None]] = set()


def _close_replaced(device: Device) -> None:
    task = asyncio.create_task(device.close(CLOSE_REPLACED))
    _closing.add(task)
    task.add_done_callback(_closing.discard)


def _now() -> float:
    return asyncio.get_running_loop().time()


def _detectors_for(session: Session, you: str | None) -> dict[str | None, SpeechDetector]:
    if session.mode == "call":
        return {source: SpeechDetector(source) for source in CALL_SOURCES}
    return {you: SpeechDetector(you)}


def _voice_book_for(session: Session) -> VoiceBook | None:
    if session.mode == "call":
        return VoiceBook(MEETING_VOICES)
    if session.mode == "together":
        return VoiceBook([p.id for p in session.participants])
    return None


def _default_server_voice(session: Session) -> set[str]:
    if session.mode == "call":
        return set()
    return {p.id for p in session.participants}


def _origin_allowed(websocket: WebSocket, allowed_origin: str) -> bool:
    origin = websocket.headers.get("origin")
    return (
        origin is None
        or origin == allowed_origin
        or (origin == own_origin(websocket) and is_trusted_host(websocket))
    )


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
        device: StreamSender,
        seat: Seat | None = None,
    ) -> None:
        self._websocket = websocket
        self._session = session
        self._settings = settings
        self._translator = translator
        self._synthesizer = synthesizer
        self._you = seat.participant_id if seat else None
        self._room = seat.room if seat else None
        self._sender: Sender = (
            RoomSender(seat.room, seat.participant_id, device) if seat else device
        )
        self._detectors = _detectors_for(session, self._you)
        if seat is None and session.voice_book is None:
            session.voice_book = _voice_book_for(session)
        self._pending: asyncio.Queue[AudioSegment] = asyncio.Queue(MAX_PENDING_UTTERANCES)
        self._in_flight: AudioSegment | None = None
        self._ended_at: dict[str, float] = {}
        self._voices: asyncio.Queue[_VoiceRequest] = asyncio.Queue(MAX_PENDING_VOICES)
        self._speaking: _VoiceRequest | None = None
        self._server_voice_for = (
            seat.room.server_voice_for if seat else _default_server_voice(session)
        )
        self._voice_for: dict[str, str] = seat.room.voice_for if seat else {}
        self._recent_voices: deque[PlayedVoice] = (
            seat.room.recent_voices if seat else deque(maxlen=MAX_REMEMBERED)
        )
        self._translations: dict[tuple[str, str], str] = seat.room.translations if seat else {}
        self._heard_in_meeting: deque[_Heard] = deque(maxlen=MAX_REMEMBERED)
        self._said_here: deque[_Heard] = deque(maxlen=MAX_REMEMBERED)
        self._recent_sentences: deque[str] = (
            seat.room.recent_sentences if seat else deque(maxlen=CONTEXT_SENTENCES)
        )
        self.ended = False

    async def run(self) -> None:
        translating = asyncio.create_task(self._translate_in_order())
        speaking = None
        if self._synthesizer is not None:
            speaking = asyncio.create_task(self._speak_in_order(self._synthesizer))
        workers = [task for task in (translating, speaking) if task is not None]
        try:
            stop_requested = await self._receive()
            self.ended = stop_requested
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
        you = (
            {"you": self._you, "connected": sorted(self._room.devices)}
            if self._you and self._room
            else {}
        )
        await self._sender.send(
            "session.ready",
            session_id=self._session.id,
            participants=[p.model_dump() for p in self._session.participants],
            server_voice=self._synthesizer is not None,
            mode=self._session.mode,
            **you,
        )
        while True:
            try:
                message = await asyncio.wait_for(self._websocket.receive(), QUIET_LIMIT_SECONDS)
            except TimeoutError:
                with contextlib.suppress(Exception):
                    await self._websocket.close(code=CLOSE_QUIET)
                return False
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
                f"voice.settings needs listener_id {self._ids()} and server_voice true or false.",
            )
        elif not _is_voice_choice(voice):
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "voice must be a voice name of 1 to 64 letters, digits, '_' or '-',"
                " or null for the automatic voice.",
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

    async def _voice_played(self, message: dict[str, Any]) -> None:
        utterance_id, listener_id = message.get("utterance_id"), message.get("listener_id")
        seconds = message.get("seconds")
        if self._you is not None:
            listener_id = self._you
        if (
            not isinstance(utterance_id, str)
            or not isinstance(listener_id, str)
            or isinstance(seconds, bool)
            or not isinstance(seconds, int | float)
            or not 0 <= seconds <= MAX_PLAYED_SECONDS
        ):
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                "voice.played needs utterance_id, listener_id and the seconds played,"
                f" 0 to {MAX_PLAYED_SECONDS}.",
            )
            return
        text = self._translations.get((utterance_id, listener_id))
        if text is None:
            return
        now = _now()
        started = now - seconds - ECHO_MARGIN_SECONDS
        self._recent_voices.append(
            PlayedVoice(listener_id, text, started, now + ECHO_MARGIN_SECONDS)
        )

    async def _set_language(self, participant_id: object, language: object) -> None:
        participants = self._session.participants
        person = next((p for p in participants if p.id == participant_id), None)
        code = language_code(language) if isinstance(language, str) else None
        if person is None:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE, f"language.set needs participant_id {self._ids()}."
            )
        elif code is None:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                invalid_language_message(language)
                if isinstance(language, str)
                else "language.set needs a language code such as te, hi, en or yue.",
            )
        else:
            person.preferred_language = code
            await self._sender.send(
                "participants.updated", participants=[p.model_dump() for p in participants]
            )

    async def _fix_voice(self, utterance_id: object, voice: object) -> None:
        book = self._session.voice_book
        if book is None or not isinstance(utterance_id, str) or voice not in book.labels:
            choices = " or ".join(f"'{label}'" for label in book.labels) if book else "none here"
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                f"voice.fix needs an utterance_id and a voice ({choices}).",
            )
            return
        book.fix(utterance_id, str(voice))

    async def _share_words(self, text: object) -> None:
        if not isinstance(text, str) or len(text) > MAX_LIVE_WORDS:
            await self._sender.error(
                ErrorCode.INVALID_MESSAGE,
                f"words.live needs text of at most {MAX_LIVE_WORDS} characters.",
            )
            return
        if self._room is None:
            return
        for device_id, device in list(self._room.devices.items()):
            if device_id != self._you:
                device.post("words.live", speaker_id=self._you, text=text)

    async def _recognise_voice(self, segment: AudioSegment) -> str | None:
        book = self._session.voice_book
        if book is None:
            return None
        heard = await asyncio.to_thread(voice_print, segment.pcm)
        return book.match(segment.utterance_id, heard) if heard is not None else None

    def _ids(self) -> str:
        return " or ".join(f"'{p.id}'" for p in self._session.participants)

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
            case "voice.played":
                await self._voice_played(parsed)
            case "voice.fix":
                await self._fix_voice(parsed.get("utterance_id"), parsed.get("voice"))
            case "words.live":
                await self._share_words(parsed.get("text"))
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
            return
        self._ended_at[segment.utterance_id] = _now()

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
                self._ended_at.pop(segment.utterance_id, None)
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

        if not await self._within_budget(segment.utterance_id):
            return

        participants = [p.model_copy() for p in self._session.participants]
        targets = list(dict.fromkeys(p.preferred_language for p in participants))
        speaker = next((p for p in participants if p.id == segment.speaker_id), None)
        ended_at = self._ended_at.get(segment.utterance_id, _now())
        started = _now()
        try:
            result = await self._translator.translate_speech(
                encode_wav(segment.pcm),
                "audio/wav",
                targets,
                context=list(self._recent_sentences),
                speaker_language=speaker.preferred_language if speaker else None,
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
        understood = _now()
        logger.info(
            "Sentence %s: %.1f s of speech, waited %.2f s, understood in %.2f s,"
            " shown %.2f s after it ended",
            segment.utterance_id[:8],
            segment.duration_ms / 1000,
            started - ended_at,
            understood - started,
            understood - ended_at,
        )
        heard = _Heard(
            ended_at - segment.duration_ms / 1000, ended_at, result.text, segment.utterance_id
        )
        if self._is_echo(heard) or self._overheard(segment.speaker_id, heard):
            await self._sender.send("utterance.ignored", utterance_id=segment.utterance_id)
            return

        self._recent_sentences.append(result.text)
        speaker_id = segment.speaker_id
        voice = None
        if speaker_id is None:
            understood = [
                p for p in participants if result.for_language(p.preferred_language).same_language
            ]
            if len(understood) == 1:
                speaker_id = understood[0].id
            elif len(understood) > 1:
                voice = speaker_id = await self._recognise_voice(segment)
            listeners = [p for p in participants if p not in understood]
        else:
            listeners = [p for p in participants if p.id != speaker_id]
            if self._session.mode == "call" and speaker_id != YOU:
                voice = await self._recognise_voice(segment)
        await self._sender.send(
            "transcript.final",
            utterance_id=segment.utterance_id,
            speaker_id=speaker_id,
            voice=voice,
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
            self._remember_translation(segment.utterance_id, listener.id, text)
            if listener.id in self._server_voice_for:
                voices.setdefault((text, self._voice_for.get(listener.id)), []).append(listener.id)
        await self._remember_meeting(speaker_id, heard)
        if self._synthesizer is None:
            return
        for (text, voice), listener_ids in voices.items():
            await self._queue_voice(
                _VoiceRequest(segment.utterance_id, tuple(listener_ids), text, voice, ended_at)
            )

    async def _within_budget(self, utterance_id: str) -> bool:
        budget = self._session.budget
        if budget is None:
            return True
        limiter: RateLimiter = self._websocket.app.state.limiter
        try:
            limiter.use(budget.identity, budget.allowance)
        except TooManyRequests as exc:
            message = (
                f"This API key used up its {budget.allowance.per_day} requests for today."
                " It starts again at midnight UTC."
                if exc.daily
                else f"This API key is sending sentences too quickly. Wait {exc.wait_seconds} s."
            )
            await self._sender.error(
                ErrorCode.QUOTA_EXCEEDED,
                message,
                utterance_id=utterance_id,
                retryable=not exc.daily,
            )
            return False
        return True

    def _remember_translation(self, utterance_id: str, listener_id: str, text: str) -> None:
        self._translations[(utterance_id, listener_id)] = text
        while len(self._translations) > MAX_REMEMBERED_TRANSLATIONS:
            del self._translations[next(iter(self._translations))]

    def _is_echo(self, said: _Heard) -> bool:
        return any(
            (self._you is None or played.listener_id == self._you)
            and said.overlaps(played.sent, played.until)
            and is_echo(said.text, played.text)
            for played in self._recent_voices
        )

    def _overheard(self, speaker_id: str | None, said: _Heard) -> bool:
        return (
            self._session.mode == "call"
            and speaker_id == YOU
            and any(
                said.overlaps(heard.start, heard.end) and is_overheard(said.text, heard.text)
                for heard in self._heard_in_meeting
            )
        )

    async def _remember_meeting(self, speaker_id: str | None, heard: _Heard) -> None:
        if self._session.mode != "call":
            return
        if speaker_id == YOU:
            self._said_here.append(heard)
            return
        self._heard_in_meeting.append(heard)
        for said in list(self._said_here):
            if said.overlaps(heard.start, heard.end) and is_overheard(said.text, heard.text):
                self._said_here.remove(said)
                await self._sender.send("utterance.ignored", utterance_id=said.utterance_id)

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
        started = _now()
        try:
            audio = await synthesizer.synthesize(request.text, request.voice)
        except VoiceFailed as failure:
            await self._voice_failed(request, failure.message)
            return
        made = _now()
        logger.info(
            "Voice %s: made in %.2f s, ready %.2f s after the sentence ended",
            request.utterance_id[:8],
            made - started,
            made - request.ended_at,
        )
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
    sessions: SessionStore,
    session_id: str,
    settings: Settings,
    translator: SpeechTranslator | None,
    synthesizer: SpeechSynthesizer | None,
) -> None:
    if not await _accept(websocket, settings):
        return

    session = sessions.get(session_id)
    if session is None:
        await _refuse(
            websocket,
            ErrorCode.UNKNOWN_SESSION,
            "This conversation does not exist or has ended. Start a new one.",
            CLOSE_UNKNOWN_SESSION,
        )
        return

    device = StreamSender(websocket)
    if (replaced := sessions.connect(session, device)) is not None:
        _close_replaced(replaced)
    handler = StreamHandler(websocket, session, settings, translator, synthesizer, device)
    try:
        await _run(handler, session.id)
    finally:
        sessions.disconnect(session, device, ended=handler.ended)
        await device.stop_posting()


def tell_others(room: Room, participant_id: str, message_type: str) -> None:
    for other_id, device in list(room.devices.items()):
        if other_id != participant_id:
            device.post(message_type, participant_id=participant_id)


def announce_people(room: Room) -> None:
    participants = [p.model_dump() for p in room.conversation.participants]
    for device in list(room.devices.values()):
        device.post("participants.updated", participants=participants)


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
    if room is None or room.ended:
        await _refuse(
            websocket,
            ErrorCode.UNKNOWN_SESSION,
            "This conversation does not exist or has ended. Ask for a new invite link.",
            CLOSE_UNKNOWN_SESSION,
        )
        return
    participant_id = room.participant_for(token)
    if participant_id is None:
        await websocket.close(code=CLOSE_FORBIDDEN)
        return

    device = StreamSender(websocket)
    if (replaced := rooms.connect(room, participant_id, device)) is not None:
        _close_replaced(replaced)
    else:
        tell_others(room, participant_id, "peer.connected")
    seat = Seat(room, participant_id)
    handler = StreamHandler(
        websocket, room.session(), settings, translator, synthesizer, device, seat
    )
    try:
        await _run(handler, room.id)
    finally:
        if rooms.disconnect(room, participant_id, device, ended=handler.ended):
            tell_others(room, participant_id, "peer.left" if handler.ended else "peer.disconnected")
            if handler.ended and participant_id != HOST_ID:
                announce_people(room)
        await device.stop_posting()
