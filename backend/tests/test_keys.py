import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.services.key_store import KEY_PREFIX, KeyStore
from tests.conftest import (
    ELSEWHERE,
    FRONTEND,
    HOST_KEY,
    TEST_HOST,
    VALID_BODY,
    make_client,
    receive,
)
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_pipeline import speak

HOST = {"name": "Host", "preferred_language": "en"}


def server(**settings):
    return make_client(
        Settings(_env_file=None, frontend_origin=FRONTEND, **settings),
        translator=FakeTranslator(),
        synthesizer=FakeSynthesizer(),
    )


def from_elsewhere(client: TestClient) -> TestClient:
    return TestClient(client.app, base_url=f"http://{TEST_HOST}", client=ELSEWHERE)


def next_of(ws, *types: str) -> dict:
    while (message := receive(ws))["type"] not in types:
        pass
    return message


def new_key(client, name: str = "Shop", daily_limit: int = 1000) -> dict:
    response = client.post("/api/keys", json={"name": name, "daily_limit": daily_limit})
    assert response.status_code == 201
    return response.json()


def with_key(secret: str) -> dict:
    return {"X-Api-Key": secret}


def test_a_new_key_is_shown_once_and_only_its_start_is_kept() -> None:
    client = server()

    created = new_key(client)
    answer = client.get("/api/keys").json()
    listed = answer["keys"]

    secret = created["secret"]
    assert secret.startswith(KEY_PREFIX)
    assert len(secret) > 40
    assert created["key"]["shown"] == secret[:10]
    assert listed == [created["key"]]
    assert secret not in str(answer)
    assert {"public_url", "public_url_problem"} <= answer.keys()


def test_a_key_lets_another_app_start_a_conversation_from_anywhere() -> None:
    client = server()
    secret = new_key(client)["secret"]
    client = from_elsewhere(client)

    assert client.post("/api/sessions", json=VALID_BODY).status_code == 401
    assert (
        client.post("/api/sessions", json=VALID_BODY, headers=with_key(secret)).status_code == 201
    )
    assert (
        client.post(
            "/api/rooms", json={"consent": True, "host": HOST}, headers=with_key(secret)
        ).status_code
        == 201
    )
    assert client.get("/api/voices", headers=with_key(secret)).status_code == 200
    assert client.get("/api/access", headers=with_key(secret)).json() == {"host": True}


@pytest.mark.parametrize(
    "secret", ["vt_not-a-real-key", "not-even-the-right-start", ""], ids=["wrong", "odd", "empty"]
)
def test_a_wrong_key_is_refused_even_on_this_computer(secret: str) -> None:
    client = server()
    new_key(client)

    response = client.post("/api/sessions", json=VALID_BODY, headers=with_key(secret))

    assert response.status_code == 401
    assert "not valid" in response.json()["detail"]
    assert client.get("/api/access", headers=with_key(secret)).json() == {"host": False}


def test_a_revoked_key_stops_working() -> None:
    client = server()
    created = new_key(client)

    assert client.delete(f"/api/keys/{created['key']['id']}").status_code == 204
    assert client.delete(f"/api/keys/{created['key']['id']}").status_code == 404

    response = client.post("/api/sessions", json=VALID_BODY, headers=with_key(created["secret"]))
    assert response.status_code == 401
    assert client.get("/api/keys").json()["keys"] == []


def test_only_the_owner_manages_keys_and_meetings() -> None:
    client = server()
    secret = new_key(client)["secret"]
    client = from_elsewhere(client)

    for headers in ({}, with_key(secret)):
        assert client.get("/api/keys", headers=headers).status_code == 401
        assert client.post("/api/keys", json={"name": "x"}, headers=headers).status_code == 401
        assert client.get("/api/meetings", headers=headers).status_code == 401
    assert client.get("/api/keys", headers={"X-Host-Key": HOST_KEY}).status_code == 200


def test_a_key_has_a_daily_limit_and_the_list_shows_its_use() -> None:
    client = server()
    created = new_key(client, daily_limit=10)
    headers = with_key(created["secret"])

    statuses = [client.get("/api/voices", headers=headers).status_code for _ in range(11)]

    assert statuses == [200] * 10 + [429]
    refused = client.get("/api/voices", headers=headers)
    assert "10 requests for today" in refused.json()["detail"]
    assert 0 < int(refused.headers["Retry-After"]) <= 86_400
    key = client.get("/api/keys").json()["keys"][0]
    assert key["used_today"] == 10
    assert key["last_used_at"] is not None


def test_a_key_is_slowed_down_when_it_sends_too_much_in_a_minute() -> None:
    client = server(key_requests_per_minute=3)
    headers = with_key(new_key(client)["secret"])

    statuses = [client.get("/api/voices", headers=headers).status_code for _ in range(4)]
    refused = client.get("/api/voices", headers=headers)

    assert statuses == [200, 200, 200, 429]
    assert "Wait" in refused.json()["detail"]
    assert 1 <= int(refused.headers["Retry-After"]) <= 60


def test_each_sentence_counts_against_the_key() -> None:
    client = server()
    headers = with_key(new_key(client, daily_limit=10)["secret"])
    for _ in range(8):
        client.get("/api/voices", headers=headers)
    session_id = client.post("/api/sessions", json=VALID_BODY, headers=headers).json()["session_id"]

    with client.websocket_connect(f"/api/sessions/{session_id}/stream") as ws:
        receive(ws)
        speak(ws)
        assert next_of(ws, "transcript.final", "error")["type"] == "transcript.final"
        next_of(ws, "tts.audio")
        speak(ws)
        refused = next_of(ws, "transcript.final", "error")

    assert refused["type"] == "error"
    assert refused["code"] == "quota_exceeded"
    assert "10 requests for today" in refused["message"]
    assert refused["retryable"] is False


def test_the_owner_is_never_limited() -> None:
    client = server(key_requests_per_minute=1)

    statuses = {client.get("/api/voices").status_code for _ in range(30)}

    assert statuses == {200}


def test_invited_guests_are_limited() -> None:
    client = server(guest_requests_per_minute=2)
    room = client.post("/api/rooms", json={"consent": True, "host": HOST}).json()
    client = from_elsewhere(client)
    headers = {"X-Room-Id": room["room_id"], "X-Room-Token": room["invite_token"]}

    statuses = [client.get("/api/voices", headers=headers).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]


@pytest.mark.parametrize(
    "body",
    [
        {"name": ""},
        {"name": "x" * 61},
        {"name": "Shop", "daily_limit": 5},
        {"name": "Shop", "daily_limit": 100_001},
        {"name": "Shop", "secret": "mine"},
    ],
    ids=["no-name", "long-name", "tiny-limit", "huge-limit", "own-secret"],
)
def test_a_key_needs_a_name_and_a_sensible_limit(body: dict) -> None:
    assert server().post("/api/keys", json=body).status_code == 422


def test_there_is_a_limit_on_how_many_keys_exist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.key_store.MAX_KEYS", 2)
    client = server()
    new_key(client)
    new_key(client)

    response = client.post("/api/keys", json={"name": "Third"})

    assert response.status_code == 409


def test_keys_are_kept_across_restarts(tmp_path) -> None:
    path = tmp_path / "keys.db"
    first = KeyStore(path)
    key, secret = first.create("Shop", 500)
    first.close()

    again = KeyStore(path)

    assert again.find(secret) == key
    assert again.find(secret + "x") is None
    assert len(again.all()) == 1
    again.close()
