import base64
import copy

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from tests.conftest import FRONTEND, VALID_BODY, make_client
from tests.fakes import VOICE_LIMIT, FakeSynthesizer, FakeTranslator
from tests.test_pipeline import open_stream, speak


def voiced(synthesizer: FakeSynthesizer, translator=None, settings=None):
    return make_client(settings, translator=translator or FakeTranslator(), synthesizer=synthesizer)


def test_ready_says_whether_the_server_makes_voices() -> None:
    with open_stream(make_client(translator=FakeTranslator())) as ws:
        assert ws.receive_json()["server_voice"] is False
    with open_stream(voiced(FakeSynthesizer())) as ws:
        assert ws.receive_json()["server_voice"] is True


def test_translation_is_spoken_for_the_listener() -> None:
    synthesizer = FakeSynthesizer()

    with open_stream(voiced(synthesizer)) as ws:
        ws.receive_json()
        speak(ws)
        received, _, _ = (ws.receive_json() for _ in range(3))
        voice = ws.receive_json()

    assert voice["type"] == "tts.audio"
    assert (voice["utterance_id"], voice["listener_id"], voice["format"]) == (
        received["utterance_id"],
        "A",
        "wav",
    )
    assert base64.b64decode(voice["audio_base64"]) == b"RIFF-voice"
    assert synthesizer.texts == ["How are you? [en]"]


def test_a_third_language_is_spoken_for_both_people() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="hi", text="नमस्ते", language_name="Hindi")

    with open_stream(voiced(synthesizer, translator)) as ws:
        ws.receive_json()
        speak(ws)
        messages = [ws.receive_json() for _ in range(6)]

    voices = [m["listener_id"] for m in messages if m["type"] == "tts.audio"]
    assert voices == ["A", "B"]


def test_nothing_is_spoken_when_everyone_understands() -> None:
    synthesizer = FakeSynthesizer()
    body = copy.deepcopy(VALID_BODY)
    body["participants"][0]["preferred_language"] = "te"

    with open_stream(voiced(synthesizer), body) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(2)]
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    assert synthesizer.texts == []


def test_a_failed_voice_tells_the_browser_to_use_its_own() -> None:
    with open_stream(voiced(FakeSynthesizer(failure=VOICE_LIMIT))) as ws:
        ws.receive_json()
        speak(ws)
        received = ws.receive_json()
        [ws.receive_json() for _ in range(2)]
        error = ws.receive_json()

    assert (error["code"], error["utterance_id"]) == ("voice_unavailable", received["utterance_id"])
    assert error["listener_id"] == "A"
    assert error["retryable"] is False
    assert "limit" in error["message"]


def test_an_unexpected_voice_crash_keeps_later_voices_working() -> None:
    class BrokenOnce(FakeSynthesizer):
        async def synthesize(self, text: str) -> bytes:
            if not self.texts:
                self.texts.append(text)
                raise RuntimeError("boom")
            return await super().synthesize(text)

    with open_stream(voiced(BrokenOnce())) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]
        error = ws.receive_json()
        speak(ws)
        later = [ws.receive_json()["type"] for _ in range(4)]

    assert error["code"] == "voice_unavailable"
    assert "boom" not in error["message"]
    assert later[-1] == "tts.audio"


def test_a_slow_voice_does_not_hold_back_the_next_translation() -> None:
    with open_stream(voiced(FakeSynthesizer(delays=[1.0, 0.0]))) as ws:
        ws.receive_json()
        speak(ws)
        speak(ws)
        messages = [ws.receive_json() for _ in range(8)]

    ids = [m["utterance_id"] for m in messages if m["type"] == "utterance.received"]
    order = [(m["type"], m["utterance_id"]) for m in messages]
    assert order.index(("translation.final", ids[1])) < order.index(("tts.audio", ids[0]))
    assert [m["utterance_id"] for m in messages if m["type"] == "tts.audio"] == ids


def test_too_many_waiting_voices_fall_back_to_the_browser() -> None:
    with open_stream(voiced(FakeSynthesizer(delays=[2.0]))) as ws:
        ws.receive_json()
        for _ in range(7):
            speak(ws, seconds=0.5)
        messages = [ws.receive_json() for _ in range(22)]

    ids = [m["utterance_id"] for m in messages if m["type"] == "utterance.received"]
    busy = [(m["code"], m["utterance_id"]) for m in messages if m["type"] == "error"]
    assert busy == [("voice_unavailable", ids[-1])]


def test_end_waits_for_the_last_voice() -> None:
    with open_stream(voiced(FakeSynthesizer(delays=[0.3]))) as ws:
        ws.receive_json()
        speak(ws)
        ws.send_json({"type": "session.stop"})
        types = [ws.receive_json()["type"] for _ in range(4)]
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert types[-1] == "tts.audio"
    assert closed.value.code == 1000


def test_end_reports_a_voice_it_could_not_finish(monkeypatch) -> None:
    from app.api import stream

    monkeypatch.setattr(stream, "STOP_GRACE_SECONDS", 0)
    settings = Settings(_env_file=None, frontend_origin=FRONTEND, speech_timeout_seconds=0.3)

    with open_stream(voiced(FakeSynthesizer(delays=[5.0]), settings=settings)) as ws:
        ws.receive_json()
        speak(ws)
        received = ws.receive_json()
        [ws.receive_json() for _ in range(2)]
        ws.send_json({"type": "session.stop"})
        error = ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert (error["code"], error["utterance_id"]) == ("voice_unavailable", received["utterance_id"])
    assert closed.value.code == 1000


def test_leaving_while_a_voice_is_being_made_is_handled() -> None:
    client = voiced(FakeSynthesizer(delays=[1.0]))

    with open_stream(client) as ws:
        ws.receive_json()
        speak(ws)
        [ws.receive_json() for _ in range(3)]

    with open_stream(client) as ws:
        assert ws.receive_json()["type"] == "session.ready"


def test_people_with_the_same_language_share_one_voice() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="hi", text="नमस्ते", language_name="Hindi")
    body = copy.deepcopy(VALID_BODY)
    body["participants"][1]["preferred_language"] = "en"

    with open_stream(voiced(synthesizer, translator), body) as ws:
        ws.receive_json()
        speak(ws)
        messages = [ws.receive_json() for _ in range(6)]

    translations = [m["listener_id"] for m in messages if m["type"] == "translation.final"]
    voices = [m["listener_id"] for m in messages if m["type"] == "tts.audio"]
    assert translations == ["A", "B"]
    assert voices == ["A", "B"]
    assert len(synthesizer.texts) == 1


def test_a_failed_shared_voice_is_reported_for_each_listener() -> None:
    translator = FakeTranslator(language="hi", text="नमस्ते", language_name="Hindi")
    body = copy.deepcopy(VALID_BODY)
    body["participants"][1]["preferred_language"] = "en"

    with open_stream(voiced(FakeSynthesizer(failure=VOICE_LIMIT), translator), body) as ws:
        ws.receive_json()
        speak(ws)
        messages = [ws.receive_json() for _ in range(6)]

    errors = [(m["code"], m["listener_id"]) for m in messages if m["type"] == "error"]
    assert errors == [("voice_unavailable", "A"), ("voice_unavailable", "B")]
