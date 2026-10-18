import pytest
from fastapi.testclient import TestClient

from tests.audio import frames, silence, tone
from tests.test_pipeline import open_stream


def test_a_pause_in_speech_ends_the_sentence_by_itself(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        for frame in frames(tone(1.0) + silence(2.0)):
            ws.send_bytes(frame)
        received = ws.receive_json()

    assert received["type"] == "utterance.received"
    assert received["duration_ms"] == 1300


def test_silence_sends_nothing(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        for frame in frames(silence(3.0)):
            ws.send_bytes(frame)
        ws.send_json({"type": "audio.pause"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_a_bad_frame_is_reported_and_listening_continues(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00\x00\x00")
        error = ws.receive_json()
        ws.send_json({"type": "ping"})
        after = ws.receive_json()

    assert (error["code"], error["utterance_id"]) == ("invalid_message", None)
    assert after["type"] == "pong"


@pytest.mark.parametrize("old", ["utterance.start", "utterance.end"])
def test_talk_button_messages_are_no_longer_accepted(client: TestClient, old: str) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json({"type": old})
        error = ws.receive_json()

    assert error["code"] == "invalid_message"
    assert old in error["message"]
