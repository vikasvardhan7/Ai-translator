import pytest

from app.core.config import Settings
from app.models.protocol import ErrorCode
from app.services.translation.base import TranslationFailed
from tests.audio import frames, tone
from tests.conftest import FRONTEND, VALID_BODY, make_client
from tests.fakes import FakeTranslator

UID = "0f8fad5b-d9cb-469f-a165-70867728950e"
OTHER = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"


def open_stream(client):
    session_id = client.post("/api/sessions", json=VALID_BODY).json()["session_id"]
    return client.websocket_connect(f"/api/sessions/{session_id}/stream")


def speak(ws, utterance_id=UID, speaker_id="B", spoken_language=None, seconds=1.0) -> None:
    ws.send_json(
        {
            "type": "utterance.start",
            "utterance_id": utterance_id,
            "speaker_id": speaker_id,
            "spoken_language": spoken_language,
        }
    )
    for frame in frames(tone(seconds)):
        ws.send_bytes(frame)
    ws.send_json({"type": "utterance.end", "utterance_id": utterance_id})


def conversation(translator, *turns) -> list[dict]:
    with open_stream(make_client(translator=translator)) as ws:
        ws.receive_json()
        messages = []
        for turn in turns:
            speak(ws, **turn)
            messages += [ws.receive_json() for _ in range(3)]
    return messages


def test_speech_is_transcribed_and_translated_for_the_listener() -> None:
    translator = FakeTranslator()

    received, transcript, translation = conversation(translator, {})

    assert received["type"] == "utterance.received"
    assert transcript == {
        "type": "transcript.final",
        "seq": 3,
        "utterance_id": UID,
        "speaker_id": "B",
        "text": "మీరు ఎలా ఉన్నారు?",
        "language": "te",
        "language_name": "Telugu",
    }
    assert translation == {
        "type": "translation.final",
        "seq": 4,
        "utterance_id": UID,
        "speaker_id": "B",
        "listener_id": "A",
        "target_language": "en",
        "text": "How are you?",
        "translated": True,
    }
    call = translator.calls[0]
    assert (call.mime_type, call.target_language, call.spoken_language) == ("audio/wav", "en", None)
    assert call.audio.startswith(b"RIFF")


def test_speech_already_in_the_listeners_language_is_not_translated() -> None:
    translator = FakeTranslator(language="en", text="I am fine", translation="I am fine.")

    _, _, translation = conversation(translator, {})

    assert translation["translated"] is False
    assert translation["text"] == "I am fine"


def test_listener_is_the_other_person() -> None:
    translator = FakeTranslator(language="en", text="Hello", translation="నమస్కారం")

    _, _, translation = conversation(translator, {"speaker_id": "A"})

    assert translation["listener_id"] == "B"
    assert translation["target_language"] == "te"
    assert translator.calls[0].target_language == "te"


def test_pinned_spoken_language_is_passed_to_the_provider() -> None:
    translator = FakeTranslator()

    conversation(translator, {"spoken_language": "te"})

    assert translator.calls[0].spoken_language == "te"


def test_provider_failure_is_reported_on_the_utterance() -> None:
    failure = TranslationFailed(ErrorCode.QUOTA_EXCEEDED, "Limit reached.", retryable=True)

    with open_stream(make_client(translator=FakeTranslator(failure=failure))) as ws:
        ws.receive_json()
        speak(ws)
        ws.receive_json()
        error = ws.receive_json()

    assert error["code"] == "quota_exceeded"
    assert error["utterance_id"] == UID
    assert error["retryable"] is True


def test_missing_key_gives_a_setup_message() -> None:
    with open_stream(make_client(translator=None)) as ws:
        ws.receive_json()
        speak(ws)
        ws.receive_json()
        error = ws.receive_json()

    assert error["code"] == "provider_unavailable"
    assert "GEMINI_API_KEY" in error["message"]
    assert error["retryable"] is False


def test_receiving_continues_while_a_sentence_is_being_translated() -> None:
    translator = FakeTranslator(delays=[0.5])

    with open_stream(make_client(translator=translator)) as ws:
        ws.receive_json()
        speak(ws)
        assert ws.receive_json()["type"] == "utterance.received"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        assert ws.receive_json()["type"] == "transcript.final"


def test_results_keep_the_order_of_speaking_when_sent_back_to_back() -> None:
    translator = FakeTranslator(delays=[0.4, 0.0])

    with open_stream(make_client(translator=translator)) as ws:
        ws.receive_json()
        speak(ws, utterance_id=UID)
        speak(ws, utterance_id=OTHER, speaker_id="A")
        messages = [ws.receive_json() for _ in range(6)]

    finals = [m["utterance_id"] for m in messages if m["type"] == "translation.final"]
    assert finals == [UID, OTHER]
    assert [m["seq"] for m in messages] == list(range(2, 8))


def test_session_stop_waits_for_pending_translations() -> None:
    from starlette.websockets import WebSocketDisconnect

    translator = FakeTranslator(delays=[0.3])

    with open_stream(make_client(translator=translator)) as ws:
        ws.receive_json()
        speak(ws)
        ws.send_json({"type": "session.stop"})
        types = [ws.receive_json()["type"] for _ in range(3)]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert types == ["utterance.received", "transcript.final", "translation.final"]
    assert closed.value.code == 1000


def test_session_stop_reports_sentences_it_could_not_finish(monkeypatch) -> None:
    from starlette.websockets import WebSocketDisconnect

    from app.api import stream

    monkeypatch.setattr(stream, "STOP_GRACE_SECONDS", 0)
    settings = Settings(_env_file=None, frontend_origin=FRONTEND, speech_timeout_seconds=0.2)
    translator = FakeTranslator(delays=[5.0, 5.0, 5.0])
    ids = [UID, OTHER, "2c9e6679-7425-40de-944b-e07fc1f90ae7"]

    with open_stream(make_client(settings, translator=translator)) as ws:
        ws.receive_json()
        for utterance_id in ids:
            speak(ws, utterance_id=utterance_id, seconds=0.5)
        received = [ws.receive_json()["utterance_id"] for _ in ids]
        ws.send_json({"type": "session.stop"})
        errors = [ws.receive_json() for _ in ids]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert received == ids
    assert [e["utterance_id"] for e in errors] == ids
    assert {e["code"] for e in errors} == {"provider_unavailable"}
    assert closed.value.code == 1000


def test_too_many_waiting_sentences_get_a_busy_error() -> None:
    translator = FakeTranslator(delays=[1.0])
    ids = [f"0f8fad5b-d9cb-469f-a165-7086772895{n:02d}" for n in range(7)]

    with open_stream(make_client(translator=translator)) as ws:
        ws.receive_json()
        for utterance_id in ids:
            speak(ws, utterance_id=utterance_id, seconds=0.5)
        messages = [ws.receive_json() for _ in range(len(ids) + 1)]

    busy = [m for m in messages if m["type"] == "error"]
    assert len(busy) == 1
    assert busy[0]["utterance_id"] == ids[-1]
    assert busy[0]["retryable"] is True


def test_unexpected_translator_crash_keeps_translating_later_sentences() -> None:
    class BrokenOnce(FakeTranslator):
        async def translate_speech(self, *args, **kwargs):
            if not self.calls:
                self.calls.append(None)
                raise RuntimeError("boom")
            return await super().translate_speech(*args, **kwargs)

    with open_stream(make_client(translator=BrokenOnce())) as ws:
        ws.receive_json()
        speak(ws)
        ws.receive_json()
        error = ws.receive_json()
        speak(ws, utterance_id=OTHER)
        later = [ws.receive_json()["type"] for _ in range(3)]

    assert error["code"] == "internal_error"
    assert error["utterance_id"] == UID
    assert "boom" not in error["message"]
    assert later == ["utterance.received", "transcript.final", "translation.final"]
