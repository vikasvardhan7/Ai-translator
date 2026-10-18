import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import FRONTEND, receive


def test_ready_message_is_sent_first(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        ready = receive(ws)

    assert ready["type"] == "session.ready"
    assert ready["seq"] == 1
    assert ready["session_id"] == session_id
    assert [p["id"] for p in ready["participants"]] == ["A", "B"]


def test_unknown_session_gets_error_then_close_4404(client: TestClient) -> None:
    with client.websocket_connect("/api/sessions/not-a-session/stream") as ws:
        error = receive(ws)
        assert error["type"] == "error"
        assert error["code"] == "unknown_session"
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 4404


def test_ping_pong_and_seq_increase(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
        ws.send_json({"type": "ping"})
        first = receive(ws)
        ws.send_json({"type": "ping"})
        second = receive(ws)

    assert first["type"] == "pong" and second["type"] == "pong"
    assert (first["seq"], second["seq"]) == (2, 3)


@pytest.mark.parametrize(
    ("raw", "expected_message_part"),
    [
        ("not json", "not valid JSON"),
        (json.dumps([1, 2]), "JSON object"),
        (json.dumps({"type": 5}), "string 'type'"),
        (json.dumps({"type": "dance"}), "Unknown message type 'dance'"),
        ("x" * 70_000, "too large"),
    ],
    ids=["not-json", "not-object", "type-not-text", "unknown-type", "too-large"],
)
def test_bad_messages_get_invalid_message_errors(
    client: TestClient, session_id: str, raw: str, expected_message_part: str
) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
        ws.send_text(raw)
        error = receive(ws)

    assert error["type"] == "error"
    assert error["code"] == "invalid_message"
    assert error["retryable"] is False
    assert expected_message_part in error["message"]


def test_session_stop_closes_normally(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
        ws.send_json({"type": "session.stop"})
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 1000
    assert_session_released(client, session_id)


def assert_session_released(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        assert receive(ws)["code"] == "unknown_session"


def test_a_session_opens_only_one_live_channel(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as first:
        assert receive(first)["type"] == "session.ready"
        with client.websocket_connect(f"/api/sessions/{session_id}/stream") as second:
            assert receive(second)["code"] == "unknown_session"
        first.send_json({"type": "ping"})
        assert receive(first)["type"] == "pong"


def test_session_is_released_when_the_browser_disconnects(
    client: TestClient, session_id: str
) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)

    assert_session_released(client, session_id)


def test_browser_from_other_origin_is_refused(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(
        f"/api/sessions/{session_id}/stream", headers={"Origin": "http://evil.example"}
    ) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 4403
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        assert receive(ws)["type"] == "session.ready"


def test_browser_from_frontend_origin_is_accepted(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(
        f"/api/sessions/{session_id}/stream", headers={"Origin": FRONTEND}
    ) as ws:
        assert receive(ws)["type"] == "session.ready"


TUNNEL = "abc.trycloudflare.com"


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": f"https://{TUNNEL}", "Host": TUNNEL, "X-Forwarded-Proto": "https"},
        {"Origin": f"http://{TUNNEL}", "Host": TUNNEL},
    ],
    ids=["https-tunnel", "plain-http"],
)
def test_a_page_served_from_the_same_address_is_accepted(
    client: TestClient, session_id: str, headers: dict
) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream", headers=headers) as ws:
        assert receive(ws)["type"] == "session.ready"


@pytest.mark.parametrize(
    "origin",
    ["https://evil.example", f"http://{TUNNEL}", f"https://{TUNNEL}.evil.example"],
    ids=["foreign", "wrong-scheme", "lookalike"],
)
def test_a_foreign_page_through_the_tunnel_is_refused(
    client: TestClient, session_id: str, origin: str
) -> None:
    headers = {"Origin": origin, "Host": TUNNEL, "X-Forwarded-Proto": "https"}

    with client.websocket_connect(f"/api/sessions/{session_id}/stream", headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 4403
