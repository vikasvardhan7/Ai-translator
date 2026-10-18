import pytest
from fastapi.testclient import TestClient

from tests.audio import frames, silence, tone
from tests.conftest import VALID_BODY

UID = "0f8fad5b-d9cb-469f-a165-70867728950e"


def open_stream(client: TestClient):
    session_id = client.post("/api/sessions", json=VALID_BODY).json()["session_id"]
    return client.websocket_connect(f"/api/sessions/{session_id}/stream")


def say(ws, pcm: bytes, utterance_id: str = UID, speaker_id: str = "B") -> dict:
    ws.send_json(
        {
            "type": "utterance.start",
            "utterance_id": utterance_id,
            "speaker_id": speaker_id,
            "spoken_language": None,
        }
    )
    for frame in frames(pcm):
        ws.send_bytes(frame)
    ws.send_json({"type": "utterance.end", "utterance_id": utterance_id})
    return ws.receive_json()


def test_spoken_utterance_is_received(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        received = say(ws, tone(2.1))

    assert received == {
        "type": "utterance.received",
        "seq": 2,
        "utterance_id": UID,
        "speaker_id": "B",
        "duration_ms": 2100,
    }


def test_silence_returns_audio_too_short_with_the_utterance_id(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        error = say(ws, silence(1.0))

    assert error["type"] == "error"
    assert error["code"] == "audio_too_short"
    assert error["utterance_id"] == UID


def test_too_long_is_reported_once(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        error = say(ws, tone(31.0))
        ws.send_json({"type": "ping"})
        after = ws.receive_json()

    assert error["code"] == "audio_too_long"
    assert after["type"] == "pong"


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"utterance_id": "../../etc/passwd"}, "utterance_id"),
        ({"speaker_id": "C"}, "speaker_id"),
        ({"spoken_language": "Telugu"}, "not a language code"),
        ({"extra": 1}, "extra"),
    ],
)
def test_invalid_utterance_start_is_rejected(client: TestClient, change, expected) -> None:
    message = {"type": "utterance.start", "utterance_id": UID, "speaker_id": "A"}
    message.update(change)
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json(message)
        error = ws.receive_json()

    assert error["code"] == "invalid_message"
    assert expected in error["message"]


def test_two_speakers_take_turns(client: TestClient) -> None:
    other = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    with open_stream(client) as ws:
        ws.receive_json()
        first = say(ws, tone(1.0), UID, "A")
        ws.receive_json()
        ws.receive_json()
        second = say(ws, tone(1.5), other, "B")

    assert (first["speaker_id"], second["speaker_id"]) == ("A", "B")
    assert (first["seq"], second["seq"]) == (2, 5)


def start_message(utterance_id: str = UID) -> dict:
    return {"type": "utterance.start", "utterance_id": utterance_id, "speaker_id": "A"}


def test_unfinished_utterance_is_reported_when_a_new_one_starts(client: TestClient) -> None:
    other = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json(start_message(UID))
        ws.send_bytes(tone(0.5))
        ws.send_json(start_message(other))
        discarded = ws.receive_json()
        for frame in frames(tone(1.0)):
            ws.send_bytes(frame)
        ws.send_json({"type": "utterance.end", "utterance_id": other})
        received = ws.receive_json()

    assert discarded["code"] == "invalid_message"
    assert discarded["utterance_id"] == UID
    assert received["type"] == "utterance.received"
    assert received["utterance_id"] == other


@pytest.mark.parametrize(
    "frame",
    [
        pytest.param(b"\x00\x01\x02", id="odd-byte-count"),
        pytest.param(b"\x00" * 32_002, id="longer-than-one-second"),
    ],
)
def test_malformed_frame_drops_the_utterance(client: TestClient, frame: bytes) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json(start_message())
        ws.send_bytes(frame)
        error = ws.receive_json()
        ws.send_bytes(tone(0.1))
        ws.send_json({"type": "utterance.end", "utterance_id": UID})
        ws.send_json({"type": "ping"})
        after = ws.receive_json()

    assert error["code"] == "invalid_message"
    assert error["utterance_id"] == UID
    assert after["type"] == "pong"


@pytest.mark.parametrize(
    "end",
    [
        {"type": "utterance.end", "utterance_id": UID},
        {"type": "utterance.end", "utterance_id": "1b4e28ba-2fa1-11d2-883f-0016d3cca427"},
    ],
)
def test_end_without_matching_open_utterance(client: TestClient, end: dict) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        if end["utterance_id"] != UID:
            ws.send_json(start_message())
        ws.send_json(end)
        error = ws.receive_json()

    assert error["code"] == "no_active_utterance"
    assert error["utterance_id"] == end["utterance_id"]


def test_invalid_utterance_end_payload(client: TestClient) -> None:
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json({"type": "utterance.end"})
        error = ws.receive_json()

    assert error["code"] == "invalid_message"
    assert "utterance_id" in error["message"]


def test_unexpected_server_error_sends_internal_error_and_closes(
    client: TestClient, monkeypatch
) -> None:
    from starlette.websockets import WebSocketDisconnect

    from app.services.audio_ingestion.microphone import MicrophoneInput

    def broken_finish(self, utterance_id):
        raise RuntimeError("boom")

    monkeypatch.setattr(MicrophoneInput, "finish", broken_finish)
    with open_stream(client) as ws:
        ws.receive_json()
        ws.send_json(start_message())
        ws.send_json({"type": "utterance.end", "utterance_id": UID})
        error = ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()

    assert error["code"] == "internal_error"
    assert error["retryable"] is True
    assert "boom" not in error["message"]
    assert closed.value.code == 1011
