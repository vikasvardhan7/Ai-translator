import pytest
from fastapi.testclient import TestClient

from tests.audio import frames, silence, tone
from tests.conftest import receive
from tests.test_pipeline import open_stream


def test_a_pause_in_speech_ends_the_sentence_by_itself(client: TestClient) -> None:
    with open_stream(client) as ws:
        receive(ws)
        for frame in frames(tone(1.0) + silence(2.0)):
            ws.send_bytes(frame)
        received = receive(ws)

    assert received["type"] == "utterance.received"
    assert received["duration_ms"] == 1300


def test_silence_sends_nothing(client: TestClient) -> None:
    with open_stream(client) as ws:
        receive(ws)
        for frame in frames(silence(3.0)):
            ws.send_bytes(frame)
        ws.send_json({"type": "audio.pause"})
        ws.send_json({"type": "ping"})
        assert receive(ws)["type"] == "pong"


def test_a_bad_frame_is_reported_and_listening_continues(client: TestClient) -> None:
    with open_stream(client) as ws:
        receive(ws)
        ws.send_bytes(b"\x00\x00\x00")
        error = receive(ws)
        ws.send_json({"type": "ping"})
        after = receive(ws)

    assert (error["code"], error["utterance_id"]) == ("invalid_message", None)
    assert after["type"] == "pong"


@pytest.mark.parametrize("old", ["utterance.start", "utterance.end"])
def test_talk_button_messages_are_no_longer_accepted(client: TestClient, old: str) -> None:
    with open_stream(client) as ws:
        receive(ws)
        ws.send_json({"type": old})
        error = receive(ws)

    assert error["code"] == "invalid_message"
    assert old in error["message"]


def test_the_browser_is_told_when_someone_starts_and_stops_speaking(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        for frame in frames(silence(0.5) + tone(1.0) + silence(1.5)):
            ws.send_bytes(frame)
        messages = [ws.receive_json() for _ in range(3)]

    assert [(m["type"], m.get("active")) for m in messages] == [
        ("speech.activity", True),
        ("utterance.received", None),
        ("speech.activity", False),
    ]
    assert messages[0]["speaker_id"] is None


def test_a_pause_tells_the_browser_the_speaking_stopped(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        for frame in frames(tone(0.5)):
            ws.send_bytes(frame)
        started = ws.receive_json()
        ws.send_json({"type": "audio.pause"})
        received, stopped = ws.receive_json(), ws.receive_json()

    assert (started["active"], received["type"], stopped["active"]) == (
        True,
        "utterance.received",
        False,
    )
