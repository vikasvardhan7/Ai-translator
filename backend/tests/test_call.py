import copy

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.audio import frames, silence, tone
from tests.conftest import VALID_BODY, make_client, receive
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_pipeline import open_stream

CALL_BODY = {**copy.deepcopy(VALID_BODY), "mode": "call"}


def call_client(translator=None, synthesizer=None):
    return make_client(
        translator=translator or FakeTranslator(), synthesizer=synthesizer or FakeSynthesizer()
    )


def say(ws, source: str, pcm: bytes) -> None:
    for frame in frames(pcm):
        ws.send_bytes(source.encode() + frame)


def until_closed(ws) -> list[dict]:
    ws.send_json({"type": "session.stop"})
    messages = []
    with pytest.raises(WebSocketDisconnect):
        while True:
            messages.append(receive(ws))
    return messages


def whole_call(translator, source: str, body=CALL_BODY, synthesizer=None) -> list[dict]:
    with open_stream(call_client(translator, synthesizer), body) as ws:
        receive(ws)
        say(ws, source, tone(1.0))
        return until_closed(ws)


def test_a_call_session_says_its_mode() -> None:
    client = call_client()

    created = client.post("/api/sessions", json=CALL_BODY).json()
    default = client.post("/api/sessions", json=VALID_BODY).json()

    assert (created["mode"], default["mode"]) == ("call", "together")
    with client.websocket_connect(f"/api/sessions/{created['session_id']}/stream") as ws:
        assert receive(ws)["mode"] == "call"


def test_an_unknown_mode_is_refused() -> None:
    response = make_client().post("/api/sessions", json={**VALID_BODY, "mode": "radio"})

    assert response.status_code == 422


def test_a_call_needs_the_server_voice() -> None:
    response = make_client(translator=FakeTranslator()).post("/api/sessions", json=CALL_BODY)

    assert response.status_code == 503
    assert "GEMINI_TTS_MODEL" in response.json()["detail"]


def test_the_other_side_of_the_call_is_translated_and_voiced_for_this_device() -> None:
    messages = whole_call(FakeTranslator(), "B")

    received, transcript, translation, voice = messages
    assert (received["speaker_id"], transcript["speaker_id"]) == ("B", "B")
    assert (translation["listener_id"], translation["target_language"]) == ("A", "en")
    assert (voice["type"], voice["listener_id"]) == ("tts.audio", "A")


def test_this_device_is_translated_and_voiced_for_the_call() -> None:
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    synthesizer = FakeSynthesizer()

    messages = whole_call(translator, "A", synthesizer=synthesizer)

    translation, voice = messages[2], messages[3]
    assert (translation["speaker_id"], translation["listener_id"]) == ("A", "B")
    assert (voice["type"], voice["listener_id"]) == ("tts.audio", "B")
    assert synthesizer.texts == ["Bagunnara? [te]"]


@pytest.mark.parametrize(
    ("source", "listener", "first_language"),
    [("A", "B", "en"), ("B", "A", "te")],
    ids=["speaking-their-language", "both-chose-it"],
)
def test_the_other_person_hears_every_sentence_even_in_their_own_language(
    source: str, listener: str, first_language: str
) -> None:
    body = copy.deepcopy(CALL_BODY)
    body["participants"][0]["preferred_language"] = first_language
    synthesizer = FakeSynthesizer()

    messages = whole_call(FakeTranslator(), source, body, synthesizer)

    translation = next(m for m in messages if m["type"] == "translation.final")
    assert (translation["speaker_id"], translation["listener_id"]) == (source, listener)
    assert translation["text"] == "మీరు ఎలా ఉన్నారు?"
    assert synthesizer.texts == ["మీరు ఎలా ఉన్నారు?"]


def test_a_third_language_is_translated_only_for_the_other_person() -> None:
    translator = FakeTranslator(language="hi", text="नमस्ते", language_name="Hindi")

    messages = whole_call(translator, "A")

    translations = [m for m in messages if m["type"] == "translation.final"]
    assert [(m["speaker_id"], m["listener_id"]) for m in translations] == [("A", "B")]


def test_both_sides_are_heard_at_the_same_time() -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        for mine, theirs in zip(frames(tone(1.0)), frames(tone(1.0)), strict=True):
            ws.send_bytes(b"A" + mine)
            ws.send_bytes(b"B" + theirs)
        messages = until_closed(ws)

    received = [m["speaker_id"] for m in messages if m["type"] == "utterance.received"]
    assert received == ["A", "B"]


def test_a_pause_for_one_side_leaves_the_other_listening() -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        say(ws, "A", tone(1.0))
        say(ws, "B", tone(1.0))
        ws.send_json({"type": "audio.pause", "participant_id": "B"})
        first = receive(ws)
        say(ws, "A", silence(2.0))
        messages = until_closed(ws)

    received = [m["speaker_id"] for m in messages if m["type"] == "utterance.received"]
    assert first["speaker_id"] == "B"
    assert received == ["A"]


@pytest.mark.parametrize(
    ("frame", "part"),
    [
        (b"C" + b"\x00\x00" * 10, "followed by audio"),
        (b"", "followed by audio"),
        (b"A", "followed by audio"),
        (b"A" + b"\x00\x00" * 16_001, "at most one second"),
    ],
    ids=["unknown-source", "empty", "tag-only", "over-one-second"],
)
def test_call_frames_without_a_known_source_are_refused(frame: bytes, part: str) -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        ws.send_bytes(frame)
        error = receive(ws)

    assert (error["code"], part in error["message"]) == ("invalid_message", True)


def test_a_full_second_after_the_tag_is_accepted() -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        ws.send_bytes(b"A" + b"\x00\x00" * 16_000)
        ws.send_json({"type": "ping"})
        assert receive(ws)["type"] == "pong"


@pytest.mark.parametrize(
    "side", ["C", ["A"], {"id": "A"}, 1], ids=["unknown", "list", "object", "number"]
)
def test_a_pause_for_an_unknown_side_is_refused_and_the_call_goes_on(side) -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "audio.pause", "participant_id": side})
        error = receive(ws)
        ws.send_json({"type": "ping"})
        pong = receive(ws)

    assert (error["code"], pong["type"]) == ("invalid_message", "pong")


@pytest.mark.parametrize("side", ["B", ["A"]], ids=["text", "list"])
def test_together_mode_ignores_a_side_on_pause(side) -> None:
    with open_stream(make_client(translator=FakeTranslator())) as ws:
        receive(ws)
        for frame in frames(tone(1.0)):
            ws.send_bytes(frame)
        ws.send_json({"type": "audio.pause", "participant_id": side})
        received = receive(ws)

    assert (received["type"], received["speaker_id"]) == ("utterance.received", None)


def test_a_default_session_is_ready_in_together_mode() -> None:
    with open_stream(make_client(translator=FakeTranslator())) as ws:
        assert receive(ws)["mode"] == "together"


def test_a_call_keeps_the_server_voice_on() -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "voice.settings", "listener_id": "B", "server_voice": False})
        error = receive(ws)

    assert error["code"] == "invalid_message"
