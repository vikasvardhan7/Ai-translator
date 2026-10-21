from datetime import UTC, datetime

import pytest

from app.services import room_store
from tests.conftest import make_client, receive
from tests.fakes import FakeTranslator
from tests.test_pipeline import open_stream
from tests.test_rooms import closed_code, connect, create, join, joined, people, stream

OFFER = {"kind": "offer", "pc": "p1", "sdp": "v=0..."}


def ready_all(*sockets) -> list[dict]:
    return [receive(ws) for ws in sockets]


def test_connection_set_up_goes_only_to_the_person_it_is_for() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        hindi, telugu = people(client, room, "hi", "te")
        with (
            connect(client, room, "A") as a,
            stream(client, room, hindi) as b,
            stream(client, room, telugu) as c,
        ):
            ready_all(a, b, c)
            a.send_json({"type": "rtc.signal", "to": "C", "data": OFFER})
            for ws in (a, b):
                ws.send_json({"type": "ping"})
            on_c = receive(c)
            on_a, on_b = receive(a), receive(b)

    assert on_c == {"type": "rtc.signal", "seq": on_c["seq"], "from": "A", "data": OFFER}
    assert (on_a["type"], on_b["type"]) == ("pong", "pong")


@pytest.mark.parametrize(
    "message",
    [
        {"type": "rtc.signal", "to": "A", "data": OFFER},
        {"type": "rtc.signal", "to": "B"},
        {"type": "rtc.signal", "to": "B", "data": "offer"},
        {"type": "rtc.signal", "data": OFFER},
    ],
)
def test_bad_connection_set_up_is_refused(message: dict) -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            a.send_json(message)
            error = receive(a)

    assert (error["type"], error["code"]) == ("error", "invalid_message")
    assert "rtc.signal needs 'to'" in error["message"]


def test_set_up_for_someone_who_is_not_connected_is_dropped_quietly() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            a.send_json({"type": "rtc.signal", "to": "B", "data": OFFER})
            a.send_json({"type": "rtc.signal", "to": "F", "data": OFFER})
            a.send_json({"type": "ping"})
            answer = receive(a)

    assert answer["type"] == "pong"


def test_chat_reaches_everyone_and_people_who_join_later_see_it() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        (hindi,) = people(client, room, "hi")
        with connect(client, room, "A") as a, stream(client, room, hindi) as b:
            ready_all(a, b)
            b.send_json({"type": "chat.send", "text": "  नमस्ते, can you hear me?  "})
            on_b, on_a = receive(b), receive(a)
        (telugu,) = people(client, room, "te")
        with stream(client, room, telugu) as c:
            ready_c = receive(c)

    assert {**on_a, "seq": 0} == {**on_b, "seq": 0}
    assert on_a["type"] == "chat.message"
    assert (on_a["from"], on_a["name"], on_a["text"]) == ("B", "Guest 0", "नमस्ते, can you hear me?")
    assert len(on_a["id"]) == 32
    assert on_a["sent_at"].endswith("+00:00")
    assert [line["text"] for line in ready_c["chat"]] == ["नमस्ते, can you hear me?"]


@pytest.mark.parametrize("text", ["", "   ", "x" * 1001, 5, None])
def test_empty_or_long_chat_is_refused(text: object) -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            a.send_json({"type": "chat.send", "text": text})
            error = receive(a)

    assert (error["type"], error["code"]) == ("error", "invalid_message")
    assert "1 to 1000 characters" in error["message"]


def test_a_flood_of_chat_is_slowed_down() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            for n in range(11):
                a.send_json({"type": "chat.send", "text": f"line {n}"})
            answers = [receive(a) for _ in range(11)]

    assert [m["type"] for m in answers] == ["chat.message"] * 10 + ["error"]
    assert "Too many chat messages" in answers[-1]["message"]


def test_microphone_and_camera_state_is_shared_and_kept_for_newcomers() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        (hindi,) = people(client, room, "hi")
        with connect(client, room, "A") as a:
            receive(a)
            a.send_json({"type": "media.state", "mic": False, "camera": True})
            own = receive(a)
            with stream(client, room, hindi) as b:
                ready_b = receive(b)
                b.send_json({"type": "media.state", "mic": True, "camera": False})
                told_a = receive(a)
                a.send_json({"type": "media.state", "mic": "off", "camera": True})
                error = receive(a)

    assert (own["type"], own["participant_id"], own["mic"], own["camera"]) == (
        "media.state",
        "A",
        False,
        True,
    )
    assert ready_b["media"] == {"A": {"mic": False, "camera": True}}
    assert (told_a["participant_id"], told_a["mic"], told_a["camera"]) == ("B", True, False)
    assert "media.state needs 'mic' and 'camera'" in error["message"]


def test_everyone_sees_who_is_recording_until_they_stop_or_drop() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        hindi, telugu = people(client, room, "hi", "te")
        with connect(client, room, "A") as a, stream(client, room, hindi) as b:
            ready_all(a, b)
            b.send_json({"type": "recording.set", "on": True})
            started = [receive(b), receive(a)]
            with stream(client, room, telugu) as c:
                ready_c = receive(c)
                b.close()
                stopped_on_a, dropped_on_a = receive(a), receive(a)
                stopped_on_c = receive(c)
            c_dropped = receive(a)
            a.send_json({"type": "recording.set", "on": "yes"})
            error = receive(a)

    assert [(m["type"], m["participant_id"], m["on"]) for m in started] == [
        ("recording.state", "B", True)
    ] * 2
    assert ready_c["recording"] == ["B"]
    for message in (stopped_on_a, stopped_on_c):
        assert (message["type"], message["participant_id"], message["on"]) == (
            "recording.state",
            "B",
            False,
        )
    assert (dropped_on_a["participant_id"], c_dropped["participant_id"]) == ("B", "C")
    assert "recording.set needs 'on'" in error["message"]


def test_a_person_who_leaves_stops_counting_as_recording() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        (hindi,) = people(client, room, "hi")
        with connect(client, room, "A") as a:
            receive(a)
            with stream(client, room, hindi) as b:
                receive(b)
                b.send_json({"type": "recording.set", "on": True})
                receive(b)
                b.send_json({"type": "session.stop"})
                closed_code(b)
            told = [receive(a)["type"] for _ in range(4)]
        (late,) = people(client, room, "te")
        with stream(client, room, late) as c:
            ready_c = receive(c)

    assert told == ["recording.state", "recording.state", "peer.left", "participants.updated"]
    assert ready_c["recording"] == []


@pytest.mark.parametrize(
    "message",
    [
        {"type": "chat.send", "text": "hi"},
        {"type": "rtc.signal", "to": "B", "data": OFFER},
        {"type": "media.state", "mic": True, "camera": True},
        {"type": "recording.set", "on": True},
    ],
)
def test_call_messages_work_only_in_a_call_with_a_link(message: dict) -> None:
    with open_stream(make_client(translator=FakeTranslator())) as ws:
        ready = receive(ws)
        ws.send_json(message)
        error = receive(ws)

    assert "chat" not in ready
    assert (error["type"], error["code"]) == ("error", "invalid_message")
    assert "works only in a call that others join with a link" in error["message"]


def test_a_guest_gone_for_two_minutes_gives_up_their_place() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        hindi, _, _ = people(client, room, "hi", "te", "ta")
        stored = client.app.state.rooms.get(room["room_id"])
        with connect(client, room, "A") as a:
            receive(a)
            with stream(client, room, hindi) as b:
                receive(b)
            dropped = receive(a)
            full = join(client, room, guest={"name": "Late", "preferred_language": "kn"})
            for guest in ("B", "C", "D"):
                stored.absent_since[guest] -= room_store.ABSENT_LIMIT * 2
            later = join(client, room, guest={"name": "Late", "preferred_language": "kn"})
            told = [receive(a) for _ in range(5)]
            with stream(client, room, hindi) as b_again:
                code = closed_code(b_again)

    assert (dropped["type"], dropped["participant_id"]) == ("peer.disconnected", "B")
    assert full.status_code == 409
    assert (later.status_code, later.json()["you"]) == (200, "E")
    assert [m["type"] for m in told] == [
        "peer.left",
        "peer.left",
        "peer.left",
        "participants.updated",
        "participants.updated",
    ]
    assert [p["id"] for p in told[-1]["participants"]] == ["A", "E"]
    assert code == 4401


def test_the_host_and_people_still_connected_keep_their_place() -> None:
    client = make_client(translator=FakeTranslator())
    with client:
        room = create(client)
        (hindi,) = people(client, room, "hi")
        stored = client.app.state.rooms.get(room["room_id"])
        with stream(client, room, hindi) as b:
            receive(b)
            stored.absent_since["A"] = datetime.now(UTC) - room_store.ABSENT_LIMIT * 2
            client.app.state.rooms.drop_absent(stored)
            with connect(client, room, "A") as a:
                ready = receive(a)

    assert [p["id"] for p in ready["participants"]] == ["A", "B"]
