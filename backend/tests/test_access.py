import logging
import re

import pytest

from app.core.access import HOST_KEY_ALPHABET, new_host_key
from app.core.config import Settings
from app.services.audio_ingestion.wav import encode_wav
from tests.audio import tone
from tests.conftest import ELSEWHERE, FRONTEND, HOST_KEY, VALID_BODY, make_client
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_account import sign_up

HOST = {"name": "Host", "preferred_language": "en"}
HELLO = encode_wav(tone(1.0))
GUEST = {"name": "Guest", "preferred_language": "te"}


def from_elsewhere():
    return make_client(translator=FakeTranslator(), synthesizer=FakeSynthesizer(), client=ELSEWHERE)


def test_this_computer_is_the_host_without_a_key() -> None:
    assert make_client().get("/api/access").json() == {"host": True}


@pytest.mark.parametrize(
    ("key", "host"),
    [
        (None, False),
        (HOST_KEY, True),
        (HOST_KEY.lower().replace("-", ""), True),
        (" k7qm 4xpa 2jrt ", True),
        ("K7QM-4XPA-2JRX", False),
        ("---", False),
    ],
    ids=["no-key", "key", "typed-loosely", "spaces", "wrong", "only-dashes"],
)
def test_elsewhere_only_the_host_key_makes_you_the_host(key: str | None, host: bool) -> None:
    headers = {"X-Host-Key": key} if key else {}

    response = from_elsewhere().get("/api/access", headers=headers)

    assert response.json() == {"host": host}


@pytest.mark.parametrize(
    "headers",
    [
        {"X-Forwarded-For": "198.51.100.7"},
        {"Cf-Connecting-Ip": "198.51.100.7"},
        {"Forwarded": "for=198.51.100.7"},
        {"Host": "rebind.example.test:8000"},
    ],
    ids=["tunnel", "cloudflare", "proxy", "renamed-host"],
)
def test_a_request_through_a_tunnel_or_a_renamed_host_needs_the_key(headers: dict) -> None:
    client = make_client()

    assert client.get("/api/access", headers=headers).json() == {"host": False}
    assert client.post("/api/sessions", json=VALID_BODY, headers=headers).status_code == 401


def test_starting_a_conversation_from_elsewhere_needs_the_host_key() -> None:
    client = from_elsewhere()
    room = {"consent": True, "host": HOST}

    refused = [
        client.post("/api/sessions", json=VALID_BODY),
        client.post("/api/rooms", json=room),
    ]
    allowed = [
        client.post("/api/sessions", json=VALID_BODY, headers={"X-Host-Key": HOST_KEY}),
        client.post("/api/rooms", json=room, headers={"X-Host-Key": HOST_KEY}),
    ]

    assert [r.status_code for r in refused] == [401, 401]
    assert "host key shown in the backend window" in refused[0].json()["detail"]
    assert [r.status_code for r in allowed] == [201, 201]


def test_an_invite_link_alone_lets_nobody_in_until_they_sign_in() -> None:
    client = from_elsewhere()
    room = client.post(
        "/api/rooms", json={"consent": True, "host": HOST}, headers={"X-Host-Key": HOST_KEY}
    ).json()
    invite = {"X-Room-Id": room["room_id"], "X-Room-Token": room["invite_token"]}
    join = {"consent": True, "token": room["invite_token"], "guest": GUEST}

    before = [
        client.post("/api/languages/detect", content=HELLO, headers=invite).status_code,
        client.get("/api/voices", headers=invite).status_code,
        client.post(f"/api/rooms/{room['room_id']}/join", json=join).status_code,
    ]
    sign_up(client, client.app.state.mailer)
    after = [
        client.post("/api/languages/detect", content=HELLO).status_code,
        client.get("/api/voices").status_code,
        client.post(f"/api/rooms/{room['room_id']}/join", json=join).status_code,
    ]
    wrong = client.post(
        f"/api/rooms/{room['room_id']}/join", json={**join, "token": "guess"}
    ).status_code

    assert before == [401, 401, 401]
    assert after == [200, 200, 200]
    assert wrong == 403


def test_a_new_host_key_is_easy_to_type_and_shown_when_the_server_starts(caplog) -> None:
    caplog.set_level(logging.INFO)
    keys = {new_host_key() for _ in range(20)}

    with make_client():
        pass

    pattern = re.compile(rf"[{HOST_KEY_ALPHABET}]{{4}}(-[{HOST_KEY_ALPHABET}]{{4}}){{2}}")
    assert all(pattern.fullmatch(key) for key in keys)
    assert len(keys) == 20
    assert f"Host key: {HOST_KEY}" in caplog.text


def test_the_key_can_be_required_on_this_computer_too() -> None:
    settings = Settings(_env_file=None, frontend_origin=FRONTEND, host_key_everywhere=True)
    client = make_client(settings)

    without = client.get("/api/access")
    with_key = client.get("/api/access", headers={"X-Host-Key": HOST_KEY})

    assert (without.json(), with_key.json()) == ({"host": False}, {"host": True})
    assert client.post("/api/sessions", json=VALID_BODY).status_code == 401
