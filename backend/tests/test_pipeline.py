import asyncio
import copy
import io
import json
import re
import wave

import pytest
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.api.stream import handle_stream
from app.core.config import Settings
from app.models.protocol import ErrorCode
from app.models.session import Participant
from app.services.session_store import Session
from app.services.translation.base import NothingRecognised, TranslationFailed
from tests.audio import frames, tone
from tests.conftest import FRONTEND, VALID_BODY, make_client
from tests.fakes import FakeSynthesizer, FakeTranslator

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def open_stream(client, body=VALID_BODY):
    session_id = client.post("/api/sessions", json=body).json()["session_id"]
    return client.websocket_connect(f"/api/sessions/{session_id}/stream")


def speak(ws, seconds: float = 1.0) -> None:
    for frame in frames(tone(seconds)):
        ws.send_bytes(frame)
    ws.send_json({"type": "audio.pause"})


def turn(translator, count: int = 3, body=VALID_BODY) -> list[dict]:
    with open_stream(make_client(translator=translator), body) as ws:
        ws.receive_json()
        speak(ws)
        return [ws.receive_json() for _ in range(count)]


def test_telugu_speech_is_translated_for_the_english_listener() -> None:
    translator = FakeTranslator()

    received, transcript, translation = turn(translator)

    utterance_id = received["utterance_id"]
    assert UUID.match(utterance_id)
    assert received == {
        "type": "utterance.received",
        "seq": 2,
        "utterance_id": utterance_id,
        "speaker_id": None,
        "duration_ms": 1000,
    }
    assert transcript == {
        "type": "transcript.final",
        "seq": 3,
        "utterance_id": utterance_id,
        "speaker_id": "B",
        "text": "మీరు ఎలా ఉన్నారు?",
        "language": "te",
        "language_name": "Telugu",
    }
    assert translation == {
        "type": "translation.final",
        "seq": 4,
        "utterance_id": utterance_id,
        "speaker_id": "B",
        "listener_id": "A",
        "target_language": "en",
        "text": "How are you? [en]",
    }
    call = translator.calls[0]
    assert (call.mime_type, call.target_languages) == ("audio/wav", ["en", "te"])
    with wave.open(io.BytesIO(call.audio)) as wav_file:
        assert wav_file.getframerate() == 16_000


def test_english_speech_is_translated_for_the_telugu_listener() -> None:
    translator = FakeTranslator(language="en", text="Hello", language_name="English")

    _, transcript, translation = turn(translator)

    assert transcript["speaker_id"] == "A"
    assert (translation["listener_id"], translation["target_language"]) == ("B", "te")


def test_a_third_language_is_translated_for_both_people() -> None:
    translator = FakeTranslator(language="hi", text="नमस्ते", language_name="Hindi")

    _, transcript, first, second = turn(translator, count=4)

    assert transcript["speaker_id"] is None
    assert [(m["listener_id"], m["target_language"]) for m in (first, second)] == [
        ("A", "en"),
        ("B", "te"),
    ]


def test_nothing_is_translated_when_both_people_understand() -> None:
    body = copy.deepcopy(VALID_BODY)
    body["participants"][0]["preferred_language"] = "te"

    with open_stream(make_client(translator=FakeTranslator()), body) as ws:
        ws.receive_json()
        speak(ws)
        received, transcript = ws.receive_json(), ws.receive_json()
        ws.send_json({"type": "ping"})
        after = ws.receive_json()

    assert (received["type"], transcript["type"], after["type"]) == (
        "utterance.received",
        "transcript.final",
        "pong",
    )
    assert transcript["speaker_id"] is None


def test_unrecognised_speech_is_ignored_and_listening_continues() -> None:
    with open_stream(make_client(translator=FakeTranslator(failure=NothingRecognised()))) as ws:
        ws.receive_json()
        speak(ws)
        received, ignored = ws.receive_json(), ws.receive_json()
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    assert ignored == {
        "type": "utterance.ignored",
        "seq": 3,
        "utterance_id": received["utterance_id"],
    }


def test_provider_failure_is_reported_on_the_utterance() -> None:
    failure = TranslationFailed(ErrorCode.QUOTA_EXCEEDED, "Limit reached.", retryable=True)

    received, error = turn(FakeTranslator(failure=failure), count=2)

    assert error["code"] == "quota_exceeded"
    assert error["utterance_id"] == received["utterance_id"]
    assert error["retryable"] is True


def test_missing_setup_gives_a_setup_message() -> None:
    _, error = turn(None, count=2)

    assert error["code"] == "provider_unavailable"
    assert "GEMINI_API_KEY" in error["message"]
    assert error["retryable"] is False


def test_listening_continues_while_a_sentence_is_being_translated() -> None:
    with open_stream(make_client(translator=FakeTranslator(delays=[0.5]))) as ws:
        ws.receive_json()
        speak(ws)
        assert ws.receive_json()["type"] == "utterance.received"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        assert ws.receive_json()["type"] == "transcript.final"


def test_results_keep_the_order_of_speaking() -> None:
    with open_stream(make_client(translator=FakeTranslator(delays=[0.4, 0.0]))) as ws:
        ws.receive_json()
        speak(ws)
        speak(ws)
        messages = [ws.receive_json() for _ in range(6)]

    received = [m["utterance_id"] for m in messages if m["type"] == "utterance.received"]
    finals = [m["utterance_id"] for m in messages if m["type"] == "translation.final"]
    assert finals == received
    assert [m["seq"] for m in messages] == list(range(2, 8))


def test_session_stop_finishes_the_sentence_being_spoken() -> None:
    with open_stream(make_client(translator=FakeTranslator(delays=[0.3]))) as ws:
        ws.receive_json()
        for frame in frames(tone(1.0)):
            ws.send_bytes(frame)
        ws.send_json({"type": "session.stop"})
        types = [ws.receive_json()["type"] for _ in range(3)]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert types == ["utterance.received", "transcript.final", "translation.final"]
    assert closed.value.code == 1000


def test_session_stop_reports_sentences_it_could_not_finish(monkeypatch) -> None:
    from app.api import stream

    monkeypatch.setattr(stream, "STOP_GRACE_SECONDS", 0)
    settings = Settings(_env_file=None, frontend_origin=FRONTEND, speech_timeout_seconds=0.2)
    translator = FakeTranslator(delays=[5.0, 5.0, 5.0])

    with open_stream(make_client(settings, translator=translator)) as ws:
        ws.receive_json()
        for _ in range(3):
            speak(ws, seconds=0.5)
        received = [ws.receive_json()["utterance_id"] for _ in range(3)]
        ws.send_json({"type": "session.stop"})
        errors = [ws.receive_json() for _ in range(3)]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert [e["utterance_id"] for e in errors] == received
    assert {e["code"] for e in errors} == {"provider_unavailable"}
    assert closed.value.code == 1000


def test_too_many_waiting_sentences_get_a_busy_error() -> None:
    with open_stream(make_client(translator=FakeTranslator(delays=[1.0]))) as ws:
        ws.receive_json()
        for _ in range(7):
            speak(ws, seconds=0.5)
        messages = [ws.receive_json() for _ in range(8)]

    received = [m["utterance_id"] for m in messages if m["type"] == "utterance.received"]
    busy = [m for m in messages if m["type"] == "error"]
    assert len(busy) == 1
    assert busy[0]["utterance_id"] == received[-1]
    assert busy[0]["retryable"] is True


def test_an_unexpected_crash_keeps_translating_later_sentences() -> None:
    class BrokenOnce(FakeTranslator):
        async def translate_speech(self, *args, **kwargs):
            if not self.calls:
                self.calls.append(None)
                raise RuntimeError("boom")
            return await super().translate_speech(*args, **kwargs)

    with open_stream(make_client(translator=BrokenOnce())) as ws:
        ws.receive_json()
        speak(ws)
        received, error = ws.receive_json(), ws.receive_json()
        speak(ws)
        later = [ws.receive_json()["type"] for _ in range(3)]

    assert (error["code"], error["utterance_id"]) == ("internal_error", received["utterance_id"])
    assert "boom" not in error["message"]
    assert later == ["utterance.received", "transcript.final", "translation.final"]


@pytest.mark.anyio
async def test_leaving_right_after_stop_is_not_a_server_failure(caplog) -> None:
    inbox: asyncio.Queue = asyncio.Queue()
    sent: list[str] = []
    gone = False
    await inbox.put({"type": "websocket.connect"})
    for frame in frames(tone(1.0)):
        await inbox.put({"type": "websocket.receive", "bytes": frame})
    await inbox.put({"type": "websocket.receive", "text": json.dumps({"type": "session.stop"})})

    async def send(message: dict) -> None:
        nonlocal gone
        if gone:
            raise OSError("browser closed")
        if text := message.get("text"):
            sent.append(json.loads(text)["type"])
        gone = sent[-1:] == ["utterance.received"]

    scope = {"type": "websocket", "path": "/", "headers": [], "query_string": b""}
    session = Session("s1", [Participant(**p) for p in VALID_BODY["participants"]], "together")
    settings = Settings(_env_file=None, speech_timeout_seconds=1)
    translator = FakeTranslator(delays=[0.2])

    await handle_stream(
        WebSocket(scope, inbox.get, send), lambda: session, settings, translator, FakeSynthesizer()
    )

    assert "Live channel failed" not in caplog.text
    assert sent == ["session.ready", "utterance.received"]
