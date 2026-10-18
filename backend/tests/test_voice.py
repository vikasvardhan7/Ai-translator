import base64

import pytest

from app.core.config import Settings
from tests.conftest import FRONTEND, make_client
from tests.fakes import VOICE_LIMIT, FakeSynthesizer, FakeTranslator
from tests.test_pipeline import OTHER, UID, open_stream, speak


def test_ready_says_whether_the_server_makes_voices() -> None:
    with open_stream(make_client(translator=FakeTranslator())) as ws:
        assert ws.receive_json()["server_voice"] is False
    client = make_client(translator=FakeTranslator(), synthesizer=FakeSynthesizer())
    with open_stream(client) as ws:
        assert ws.receive_json()["server_voice"] is True


def test_translation_is_spoken_for_the_listener() -> None:
    synthesizer = FakeSynthesizer()

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=synthesizer)) as ws:
        ws.receive_json()
        speak(ws)
        types = [ws.receive_json()["type"] for _ in range(3)]
        voice = ws.receive_json()

    assert types == ["utterance.received", "transcript.final", "translation.final"]
    assert voice["type"] == "tts.audio"
    assert (voice["utterance_id"], voice["listener_id"], voice["format"]) == (UID, "A", "wav")
    assert base64.b64decode(voice["audio_base64"]) == b"RIFF-voice"
    assert synthesizer.texts == ["How are you?"]


def test_nothing_is_spoken_when_the_listener_already_understands() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="Hello")

    with open_stream(make_client(translator=translator, synthesizer=synthesizer)) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    assert synthesizer.texts == []


def test_a_failed_voice_tells_the_browser_to_use_its_own() -> None:
    synthesizer = FakeSynthesizer(failure=VOICE_LIMIT)

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=synthesizer)) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]
        error = ws.receive_json()

    assert error["code"] == "voice_unavailable"
    assert error["utterance_id"] == UID
    assert error["retryable"] is False
    assert "limit" in error["message"]


def test_an_unexpected_voice_crash_keeps_later_voices_working() -> None:
    class BrokenOnce(FakeSynthesizer):
        async def synthesize(self, text: str) -> bytes:
            if not self.texts:
                self.texts.append(text)
                raise RuntimeError("boom")
            return await super().synthesize(text)

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=BrokenOnce())) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]
        error = ws.receive_json()
        speak(ws, utterance_id=OTHER)
        later = [ws.receive_json()["type"] for _ in range(4)]

    assert (error["code"], error["utterance_id"]) == ("voice_unavailable", UID)
    assert "boom" not in error["message"]
    assert later[-1] == "tts.audio"


def test_a_slow_voice_does_not_hold_back_the_next_translation() -> None:
    synthesizer = FakeSynthesizer(delays=[1.0, 0.0])

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=synthesizer)) as ws:
        ws.receive_json()
        speak(ws, utterance_id=UID)
        speak(ws, utterance_id=OTHER)
        messages = [ws.receive_json() for _ in range(8)]

    order = [(m["type"], m["utterance_id"]) for m in messages]
    assert order.index(("translation.final", OTHER)) < order.index(("tts.audio", UID))
    voices = [m["utterance_id"] for m in messages if m["type"] == "tts.audio"]
    assert voices == [UID, OTHER]


def test_too_many_waiting_voices_fall_back_to_text() -> None:
    synthesizer = FakeSynthesizer(delays=[2.0])
    ids = [f"0f8fad5b-d9cb-469f-a165-7086772895{n:02d}" for n in range(7)]

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=synthesizer)) as ws:
        ws.receive_json()
        for utterance_id in ids:
            speak(ws, utterance_id=utterance_id, seconds=0.5)
        messages = [ws.receive_json() for _ in range(len(ids) * 3 + 1)]

    busy = [m for m in messages if m["type"] == "error"]
    assert [(m["code"], m["utterance_id"]) for m in busy] == [("voice_unavailable", ids[-1])]


def test_end_waits_for_the_last_voice() -> None:
    from starlette.websockets import WebSocketDisconnect

    synthesizer = FakeSynthesizer(delays=[0.3])

    with open_stream(make_client(translator=FakeTranslator(), synthesizer=synthesizer)) as ws:
        ws.receive_json()
        speak(ws)
        ws.send_json({"type": "session.stop"})
        types = [ws.receive_json()["type"] for _ in range(4)]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert types[-1] == "tts.audio"
    assert closed.value.code == 1000


def test_end_reports_a_voice_it_could_not_finish(monkeypatch) -> None:
    from starlette.websockets import WebSocketDisconnect

    from app.api import stream

    monkeypatch.setattr(stream, "STOP_GRACE_SECONDS", 0)
    settings = Settings(_env_file=None, frontend_origin=FRONTEND, speech_timeout_seconds=0.3)
    synthesizer = FakeSynthesizer(delays=[5.0])
    client = make_client(settings, translator=FakeTranslator(), synthesizer=synthesizer)

    with open_stream(client) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]
        ws.send_json({"type": "session.stop"})
        error = ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert (error["code"], error["utterance_id"]) == ("voice_unavailable", UID)
    assert closed.value.code == 1000


def test_leaving_while_a_voice_is_being_made_is_handled() -> None:
    synthesizer = FakeSynthesizer(delays=[1.0])
    client = make_client(translator=FakeTranslator(), synthesizer=synthesizer)

    with open_stream(client) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]

    with open_stream(client) as ws:
        assert ws.receive_json()["type"] == "session.ready"
