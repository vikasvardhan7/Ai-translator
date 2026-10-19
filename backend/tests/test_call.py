import time

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.audio import frames, silence, tone
from tests.conftest import VALID_BODY, make_client, receive
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_pipeline import open_stream

CALL_BODY = {
    "consent": True,
    "mode": "call",
    "participants": [{"id": "A", "name": "Person A", "preferred_language": "en"}],
}
MEETING_WORDS = "Hello everyone, welcome to the review"


def call_client(translator=None, synthesizer=None):
    return make_client(
        translator=translator or FakeTranslator(), synthesizer=synthesizer or FakeSynthesizer()
    )


def say(ws, source: str, pcm: bytes) -> None:
    for frame in frames(pcm):
        ws.send_bytes(source.encode() + frame)


def at_once(ws, first: str, second: str, pcm: bytes) -> None:
    for frame in frames(pcm):
        ws.send_bytes(first.encode() + frame)
        ws.send_bytes(second.encode() + frame)


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


def shown(messages: list[dict]) -> list[tuple[str, str]]:
    ignored = {m["utterance_id"] for m in messages if m["type"] == "utterance.ignored"}
    return [
        (m["speaker_id"], m["text"])
        for m in messages
        if m["type"] == "transcript.final" and m["utterance_id"] not in ignored
    ]


def test_a_meeting_session_says_its_mode() -> None:
    client = call_client()

    created = client.post("/api/sessions", json=CALL_BODY).json()
    default = client.post("/api/sessions", json=VALID_BODY).json()

    assert (created["mode"], default["mode"]) == ("call", "together")
    assert [p["id"] for p in created["participants"]] == ["A"]
    with client.websocket_connect(f"/api/sessions/{created['session_id']}/stream") as ws:
        assert receive(ws)["mode"] == "call"


def test_an_unknown_mode_is_refused() -> None:
    response = make_client().post("/api/sessions", json={**VALID_BODY, "mode": "radio"})

    assert response.status_code == 422


def test_a_meeting_needs_no_voice_model() -> None:
    response = make_client(translator=FakeTranslator()).post("/api/sessions", json=CALL_BODY)

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("mode", "participants", "detail"),
    [
        ("call", VALID_BODY["participants"], "A meeting has one participant"),
        ("call", [{"id": "B", "name": "B", "preferred_language": "te"}], "A meeting has one"),
        ("together", CALL_BODY["participants"], "Participants must have the ids"),
    ],
    ids=["meeting-with-two", "meeting-with-b", "together-with-one"],
)
def test_the_number_of_people_must_match_the_mode(mode: str, participants, detail: str) -> None:
    body = {"consent": True, "mode": mode, "participants": participants}

    response = make_client().post("/api/sessions", json=body)

    assert response.status_code == 422
    assert detail in response.json()["detail"]


def test_the_meeting_is_translated_for_this_device_without_a_voice() -> None:
    synthesizer = FakeSynthesizer()

    messages = whole_call(FakeTranslator(), "B", synthesizer=synthesizer)

    received, transcript, translation = messages
    assert (received["speaker_id"], transcript["speaker_id"]) == ("B", "B")
    assert (translation["listener_id"], translation["target_language"]) == ("A", "en")
    assert synthesizer.texts == []


def test_your_own_words_are_shown_and_not_translated() -> None:
    translator = FakeTranslator(language="en", text="Sounds good to me")

    messages = whole_call(translator, "A")

    assert [m["type"] for m in messages] == ["utterance.received", "transcript.final"]
    assert messages[1]["speaker_id"] == "A"
    assert translator.calls[-1].target_languages == ["en"]


def test_the_meeting_can_be_heard_in_your_language_when_you_turn_the_voice_on() -> None:
    synthesizer = FakeSynthesizer()

    with open_stream(call_client(FakeTranslator(), synthesizer), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "voice.settings", "listener_id": "A", "server_voice": True})
        say(ws, "B", tone(1.0))
        messages = until_closed(ws)

    assert (messages[-1]["type"], messages[-1]["listener_id"]) == ("tts.audio", "A")
    assert synthesizer.texts == ["How are you? [en]"]


def test_the_meeting_has_no_voice_settings_of_its_own() -> None:
    with open_stream(call_client(), CALL_BODY) as ws:
        receive(ws)
        ws.send_json({"type": "voice.settings", "listener_id": "B", "server_voice": True})
        error = receive(ws)

    assert error["code"] == "invalid_message"
    assert "listener_id 'A'" in error["message"]


@pytest.mark.parametrize("first", ["B", "A"], ids=["meeting-first", "microphone-first"])
def test_the_meeting_overheard_by_the_microphone_is_shown_once(first: str) -> None:
    second = "A" if first == "B" else "B"
    overheard = "welcome to the review"
    in_order = [MEETING_WORDS, overheard] if first == "B" else [overheard, MEETING_WORDS]
    translator = FakeTranslator(language="en", transcripts=in_order)

    with open_stream(call_client(translator), CALL_BODY) as ws:
        receive(ws)
        at_once(ws, first, second, tone(1.0))
        at_once(ws, first, second, silence(1.5))
        messages = until_closed(ws)

    assert shown(messages) == [("B", MEETING_WORDS)]
    assert [m["type"] for m in messages].count("utterance.ignored") == 1


def test_the_same_words_said_later_are_kept() -> None:
    translator = FakeTranslator(language="en", transcripts=["Okay", "Okay"])

    with open_stream(call_client(translator), CALL_BODY) as ws:
        receive(ws)
        say(ws, "B", tone(1.0))
        say(ws, "B", silence(1.5))
        first = [receive(ws) for _ in range(3)]
        time.sleep(2)
        say(ws, "A", tone(1.0))
        messages = first + until_closed(ws)

    assert shown(messages) == [("B", "Okay"), ("A", "Okay")]


def test_different_words_at_the_same_time_are_both_kept() -> None:
    translator = FakeTranslator(language="en", transcripts=[MEETING_WORDS, "Can you hear me"])

    with open_stream(call_client(translator), CALL_BODY) as ws:
        receive(ws)
        at_once(ws, "B", "A", tone(1.0))
        at_once(ws, "B", "A", silence(1.5))
        messages = until_closed(ws)

    assert shown(messages) == [("B", MEETING_WORDS), ("A", "Can you hear me")]


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
