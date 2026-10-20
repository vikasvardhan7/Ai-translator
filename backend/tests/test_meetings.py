from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services import meeting_store
from app.services.meeting_store import MeetingStore
from tests.conftest import ELSEWHERE, HOST_KEY, make_client, receive
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_account import sign_up

HOST = {"name": "Vikas", "preferred_language": "en"}
GUEST = {"name": "Priya", "preferred_language": "hi"}


def soon(minutes: int = 30) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


def plan(client: TestClient, **changes) -> dict:
    body = {
        "title": "Budget review",
        "starts_at": soon(),
        "duration_minutes": 45,
        "agenda": "Numbers for Q4\nHiring",
        "host_name": "Vikas",
        **changes,
    }
    response = client.post("/api/meetings", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def look(client: TestClient, meeting: dict, token: str):
    return client.get(f"/api/meetings/{meeting['id']}", headers={"X-Meeting-Token": token})


def start(client: TestClient, meeting: dict, token: str | None = None):
    return client.post(
        f"/api/meetings/{meeting['id']}/start",
        json={"consent": True, "host": HOST},
        headers={"X-Meeting-Token": token or meeting["host_token"]},
    )


def join(client: TestClient, meeting: dict, token: str | None = None, guest=GUEST):
    return client.post(
        f"/api/meetings/{meeting['id']}/join",
        json={"consent": True, "token": token or meeting["invite_token"], "guest": guest},
    )


def test_a_meeting_is_scheduled_with_its_details_and_two_tokens(client: TestClient) -> None:
    meeting = plan(client, title="  Budget review  ")

    assert meeting["title"] == "Budget review"
    assert (meeting["duration_minutes"], meeting["agenda"]) == (45, "Numbers for Q4\nHiring")
    assert (meeting["status"], meeting["people"]) == ("upcoming", 0)
    assert meeting["host_token"] != meeting["invite_token"]
    assert min(len(meeting["host_token"]), len(meeting["invite_token"])) >= 32
    assert meeting["public_url_problem"] is not None


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "x" * 121},
        {"starts_at": "2026-10-20T10:00:00"},
        {"starts_at": (datetime.now(UTC) - timedelta(days=2)).isoformat()},
        {"starts_at": (datetime.now(UTC) + timedelta(days=400)).isoformat()},
        {"duration_minutes": 2},
        {"duration_minutes": 600},
        {"agenda": "x" * 2001},
        {"host_name": ""},
        {"extra": True},
    ],
    ids=[
        "no-title",
        "long-title",
        "no-time-zone",
        "in-the-past",
        "too-far",
        "too-short",
        "too-long",
        "long-agenda",
        "no-host",
        "unknown-field",
    ],
)
def test_a_bad_meeting_is_refused(client: TestClient, changes: dict) -> None:
    body = {
        "title": "Sync",
        "starts_at": soon(),
        "duration_minutes": 30,
        "host_name": "Vikas",
        **changes,
    }

    response = client.post("/api/meetings", json=body)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_the_host_sees_upcoming_meetings_in_time_order(client: TestClient) -> None:
    later = plan(client, title="Later", starts_at=soon(120))
    earlier = plan(client, title="Earlier", starts_at=soon(10))

    listed = client.get("/api/meetings").json()

    assert [m["title"] for m in listed["meetings"]] == ["Earlier", "Later"]
    assert {m["id"] for m in listed["meetings"]} == {earlier["id"], later["id"]}
    assert listed["meetings"][0]["invite_token"] == earlier["invite_token"]
    assert "public_url_problem" in listed


def test_scheduling_and_listing_need_the_host_key_from_elsewhere() -> None:
    client = make_client(client=ELSEWHERE)
    body = {"title": "Sync", "starts_at": soon(), "duration_minutes": 30, "host_name": "Vikas"}

    refused = client.post("/api/meetings", json=body)
    listing = client.get("/api/meetings")
    allowed = client.post("/api/meetings", json=body, headers={"X-Host-Key": HOST_KEY})

    assert (refused.status_code, listing.status_code, allowed.status_code) == (401, 401, 201)


def test_invited_people_see_the_meeting_but_not_its_tokens(client: TestClient) -> None:
    meeting = plan(client)

    seen = look(client, meeting, meeting["invite_token"])
    wrong = look(client, meeting, "guess")
    empty = look(client, meeting, "")
    unknown = client.get("/api/meetings/nope", headers={"X-Meeting-Token": "x"})

    assert seen.status_code == 200
    assert seen.json()["title"] == "Budget review"
    assert "host_token" not in seen.json() and "invite_token" not in seen.json()
    assert (wrong.status_code, empty.status_code, unknown.status_code) == (403, 403, 404)


def test_guests_wait_until_the_host_starts_then_join_the_live_call() -> None:
    client = make_client(translator=FakeTranslator(), synthesizer=FakeSynthesizer())
    with client:
        meeting = plan(client)
        early = join(client, meeting)
        started = start(client, meeting)
        room = started.json()
        status = look(client, meeting, meeting["invite_token"]).json()
        with client.websocket_connect(
            f"/api/rooms/{room['room_id']}/stream?token={room['host_token']}"
        ) as host:
            receive(host)
            joined = join(client, meeting)
            people = receive(host)
            again = start(client, meeting)
        live = look(client, meeting, meeting["invite_token"]).json()

    assert early.status_code == 409
    assert "not started" in early.json()["detail"]
    assert started.status_code == 200
    assert (room["host"]["name"], room["guests"]) == ("Vikas", [])
    assert status["status"] == "live"
    assert (joined.status_code, joined.json()["you"]) == (200, "B")
    assert [p["name"] for p in people["participants"]] == ["Vikas", "Priya"]
    assert again.json()["room_id"] == room["room_id"]
    assert (live["status"], live["people"]) == ("live", 2)


def test_only_the_host_starts_and_only_invited_people_join(client: TestClient) -> None:
    meeting = plan(client)

    by_guest = start(client, meeting, token=meeting["invite_token"])
    start(client, meeting)
    by_stranger = join(client, meeting, token="guess")

    assert (by_guest.status_code, by_stranger.status_code) == (403, 403)


def test_cancelling_ends_a_live_meeting_and_its_link() -> None:
    client = make_client(translator=FakeTranslator(), synthesizer=FakeSynthesizer())
    with client:
        meeting = plan(client)
        room = start(client, meeting).json()
        guest = join(client, meeting).json()
        with client.websocket_connect(
            f"/api/rooms/{room['room_id']}/stream?token={guest['token']}"
        ) as ws:
            receive(ws)
            by_guest = client.delete(
                f"/api/meetings/{meeting['id']}", headers={"X-Meeting-Token": guest["token"]}
            )
            cancelled = client.delete(
                f"/api/meetings/{meeting['id']}",
                headers={"X-Meeting-Token": meeting["host_token"]},
            )
            left = receive(ws)
        gone = look(client, meeting, meeting["invite_token"])

    assert (by_guest.status_code, cancelled.status_code) == (403, 204)
    assert (left["type"], left["participant_id"]) == ("peer.left", "A")
    assert gone.status_code == 404


def test_a_meeting_long_over_cannot_be_started_or_joined(client: TestClient, monkeypatch) -> None:
    meeting = plan(client, starts_at=(datetime.now(UTC) - timedelta(hours=11)).isoformat())
    monkeypatch.setattr(meeting_store, "JOIN_AFTER_END", timedelta(minutes=1))

    started = start(client, meeting)
    joined = join(client, meeting)
    listed = client.get("/api/meetings").json()["meetings"]

    assert (started.status_code, joined.status_code) == (410, 410)
    assert "over" in started.json()["detail"]
    assert listed == []


def test_an_invited_guest_signs_in_before_seeing_or_joining_the_meeting() -> None:
    client = make_client(translator=FakeTranslator(), client=ELSEWHERE)
    meeting = client.post(
        "/api/meetings",
        json={"title": "Sync", "starts_at": soon(), "duration_minutes": 30, "host_name": "V"},
        headers={"X-Host-Key": HOST_KEY},
    ).json()
    invite = {"X-Meeting-Token": meeting["invite_token"]}
    sound = {"Content-Type": "audio/wav", "X-Meeting-Id": meeting["id"], **invite}
    join = {"consent": True, "token": meeting["invite_token"], "guest": GUEST}

    before = [
        client.get(f"/api/meetings/{meeting['id']}", headers=invite).status_code,
        client.post("/api/languages/detect", content=b"RIFF", headers=sound).status_code,
        client.post(f"/api/meetings/{meeting['id']}/join", json=join).status_code,
    ]
    sign_up(client, client.app.state.mailer)
    seen = client.get(f"/api/meetings/{meeting['id']}", headers=invite)
    detected = client.post(
        "/api/languages/detect", content=b"RIFF", headers={"Content-Type": "audio/wav"}
    )
    early = client.post(f"/api/meetings/{meeting['id']}/join", json=join)

    assert before == [401, 401, 401]
    assert seen.json()["title"] == "Sync"
    assert detected.status_code != 401
    assert early.status_code == 409


def test_meetings_are_kept_in_a_file_and_old_ones_are_dropped(tmp_path: Path) -> None:
    path = tmp_path / "data" / "meetings.db"
    store = MeetingStore(path)
    kept = store.create("Kept", datetime.now(UTC) + timedelta(hours=1), 30, "", "Vikas")
    old = store.create("Old", datetime.now(UTC) - timedelta(days=9), 30, "", "Vikas")
    store.close()

    reopened = MeetingStore(path)
    found = reopened.get(kept.id)
    assert found == kept
    assert reopened.upcoming(None, with_unowned=True) == [kept]
    assert reopened.get(old.id) is None
    reopened.close()


def test_the_file_is_only_made_when_a_meeting_is_scheduled(tmp_path: Path) -> None:
    path = tmp_path / "data" / "meetings.db"
    store = MeetingStore(path)
    store.close()

    assert not path.exists()


def test_too_many_meetings_are_refused(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(meeting_store, "MAX_MEETINGS", 1)
    plan(client)

    response = client.post(
        "/api/meetings",
        json={"title": "Two", "starts_at": soon(), "duration_minutes": 30, "host_name": "V"},
    )

    assert response.status_code == 503
