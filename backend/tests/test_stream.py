import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import stream
from tests.conftest import FRONTEND, TEST_HOST, receive


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


def test_a_new_connection_takes_over_and_the_old_one_is_closed(
    client: TestClient, session_id: str
) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as first:
        assert receive(first)["type"] == "session.ready"
        with client.websocket_connect(f"/api/sessions/{session_id}/stream") as second:
            assert receive(second)["type"] == "session.ready"
            with pytest.raises(WebSocketDisconnect) as closed:
                receive(first)
            second.send_json({"type": "ping"})
            assert receive(second)["type"] == "pong"

    assert closed.value.code == 4410


def test_a_dropped_session_can_be_opened_again(client: TestClient, session_id: str) -> None:
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        ready = receive(ws)

    assert (ready["type"], ready["session_id"]) == ("session.ready", session_id)


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
THROUGH_TUNNEL = {"X-Forwarded-For": "198.51.100.7", "Cf-Connecting-Ip": "198.51.100.7"}


@pytest.mark.parametrize(
    "headers",
    [
        {
            "Origin": f"https://{TUNNEL}",
            "Host": TUNNEL,
            "X-Forwarded-Proto": "https",
            **THROUGH_TUNNEL,
        },
        {"Origin": f"http://{TEST_HOST}", "Host": TEST_HOST},
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
    headers = {"Origin": origin, "Host": TUNNEL, "X-Forwarded-Proto": "https", **THROUGH_TUNNEL}

    with client.websocket_connect(f"/api/sessions/{session_id}/stream", headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 4403


def test_a_page_that_renamed_this_computer_is_refused(client: TestClient, session_id: str) -> None:
    rebound = "rebind.example.test:8000"
    headers = {"Origin": f"http://{rebound}", "Host": rebound}

    with client.websocket_connect(f"/api/sessions/{session_id}/stream", headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)

    assert closed.value.code == 4403


def test_a_connection_that_goes_quiet_is_treated_as_dropped(
    client: TestClient, session_id: str, monkeypatch
) -> None:
    monkeypatch.setattr(stream, "QUIET_LIMIT_SECONDS", 0.3)
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
        time.sleep(0.5)
        with pytest.raises(WebSocketDisconnect) as closed:
            receive(ws)
    assert closed.value.code == 4408
    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        assert receive(ws)["type"] == "session.ready"
