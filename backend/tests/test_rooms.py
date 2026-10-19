import asyncio
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.services import room_store
from tests.conftest import make_client, receive
from tests.fakes import FakeSynthesizer, FakeTranslator
from tests.test_pipeline import speak

HOST = {"name": "Host", "preferred_language": "en"}
GUEST = {"name": "Guest", "preferred_language": "te"}
TUNNEL = "abc.trycloudflare.com"


def create(client: TestClient) -> dict:
    response = client.post("/api/rooms", json={"consent": True, "host": HOST})
    assert response.status_code == 201
    return response.json()


def join(client: TestClient, room: dict, token: str | None = None, guest=GUEST, consent=True):
    return client.post(
        f"/api/rooms/{room['room_id']}/join",
        json={"consent": consent, "token": token or room["guest_token"], "guest": guest},
    )


def joined(client: TestClient) -> dict:
    room = create(client)
    response = join(client, room)
    assert response.status_code == 200
    return {**room, "guest_device_token": response.json()["token"]}


def look(client: TestClient, room: dict, token: str):
    return client.get(f"/api/rooms/{room['room_id']}", headers={"X-Room-Token": token})


def token_of(room: dict, who: str) -> str:
    if who == "A":
        return room["host_token"]
    return room.get("guest_device_token", room["guest_token"])


def connect(client: TestClient, room: dict, who: str, headers: dict | None = None):
    return client.websocket_connect(
        f"/api/rooms/{room['room_id']}/stream?token={token_of(room, who)}", headers=headers or {}
    )


def voiced(translator: FakeTranslator | None = None, synthesizer=None) -> TestClient:
    return make_client(
        translator=translator or FakeTranslator(), synthesizer=synthesizer or FakeSynthesizer()
    )


def closed_code(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        while True:
            receive(ws)
    return closed.value.code


def test_a_room_is_created_with_two_tokens_and_no_guest(client: TestClient) -> None:
    response = client.post(
        "/api/rooms",
        json={"consent": True, "host": {"name": " Host ", "preferred_language": "EN-us"}},
    )

    data = response.json()
    assert response.status_code == 201
    assert set(data) == {"room_id", "host_token", "guest_token", "host", "guest"}
    assert data["host"] == {"id": "A", "name": "Host", "preferred_language": "en"}
    assert data["guest"] is None
    assert data["host_token"] != data["guest_token"]
    assert min(len(data["host_token"]), len(data["guest_token"])) >= 32


@pytest.mark.parametrize(
    "body",
    [
        {"consent": False, "host": HOST},
        {"consent": True, "host": {**HOST, "name": ""}},
        {"consent": True, "host": {**HOST, "name": "x" * 41}},
        {"consent": True, "host": {**HOST, "preferred_language": "English"}},
        {"consent": True, "host": {**HOST, "id": "B"}},
        {"consent": True},
    ],
    ids=["no-consent", "empty-name", "long-name", "not-a-code", "extra-field", "no-host"],
)
def test_a_bad_room_is_refused(client: TestClient, body: dict) -> None:
    response = client.post("/api/rooms", json=body)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_too_many_waiting_rooms_are_refused(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(room_store, "MAX_WAITING_ROOMS", 1)
    create(client)

    response = client.post("/api/rooms", json={"consent": True, "host": HOST})

    assert response.status_code == 503
    assert "Try again" in response.json()["detail"]


@pytest.mark.parametrize("who", ["A", "B"])
def test_either_token_can_look_at_the_room(client: TestClient, who: str) -> None:
    room = create(client)

    response = look(client, room, token_of(room, who))

    assert response.status_code == 200
    assert response.json() == {
        "room_id": room["room_id"],
        "host": {"id": "A", "name": "Host", "preferred_language": "en"},
        "guest": None,
    }


def test_looking_needs_the_right_token(client: TestClient) -> None:
    room = create(client)

    wrong = look(client, room, "not-the-token")
    unknown = client.get("/api/rooms/no-such-room", headers={"X-Room-Token": room["host_token"]})

    assert (wrong.status_code, unknown.status_code) == (403, 404)
    assert "not valid" in wrong.json()["detail"]
    assert "expired" in unknown.json()["detail"]


def test_the_guest_joins_as_b(client: TestClient) -> None:
    room = create(client)

    response = join(client, room)

    guest = {"id": "B", "name": "Guest", "preferred_language": "te"}
    assert response.status_code == 200
    assert response.json()["guest"] == guest
    assert look(client, room, room["host_token"]).json()["guest"] == guest


def test_the_invite_link_stops_working_once_someone_joins() -> None:
    client = voiced()
    with client:
        room = joined(client)
        looked = look(client, room, room["guest_token"])
        again = join(client, room)
        device = look(client, room, room["guest_device_token"])
        with client.websocket_connect(
            f"/api/rooms/{room['room_id']}/stream?token={room['guest_token']}"
        ) as ws:
            code = closed_code(ws)

    assert room["guest_device_token"] != room["guest_token"]
    assert (looked.status_code, again.status_code, device.status_code) == (403, 409, 200)
    assert code == 4401


def test_only_the_invite_token_can_join(client: TestClient) -> None:
    room = create(client)

    by_host = join(client, room, token=room["host_token"])
    by_stranger = join(client, room, token="guess")

    assert (by_host.status_code, by_stranger.status_code) == (403, 403)
    assert look(client, room, room["host_token"]).json()["guest"] is None


def test_joining_an_unknown_room_is_not_found(client: TestClient) -> None:
    room = create(client)

    response = join(client, {**room, "room_id": "no-such-room"})

    assert response.status_code == 404


def test_a_second_guest_is_refused(client: TestClient) -> None:
    room = joined(client)

    response = join(client, room, guest={"name": "Other", "preferred_language": "hi"})

    assert response.status_code == 409
    assert "already joined" in response.json()["detail"]


def test_the_guest_may_choose_the_hosts_language(client: TestClient) -> None:
    room = create(client)

    response = join(client, room, guest={"name": "Guest", "preferred_language": "EN"})

    assert response.status_code == 200
    assert response.json()["guest"]["preferred_language"] == "en"


def test_joining_needs_consent(client: TestClient) -> None:
    response = join(client, create(client), consent=False)

    assert response.status_code == 422
    assert "consent" in response.json()["detail"]


def test_a_room_nobody_joined_expires(client: TestClient) -> None:
    room = create(client)
    stored = client.app.state.rooms.get(room["room_id"])
    stored.idle_since = datetime.now(UTC) - room_store.IDLE_ROOM_LIFETIME * 2

    assert look(client, room, room["host_token"]).status_code == 404
    assert join(client, room).status_code == 404


def test_each_device_sees_both_captions_and_hears_only_its_own_voice() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, synthesizer)

    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            ready_a, ready_b = [receive(ws) for ws in (a, b)]
            speak(a)
            on_a = [receive(a) for _ in range(3)]
            on_b = [receive(b) for _ in range(4)]
            a.send_json({"type": "ping"})
            pong = receive(a)

    assert (ready_a["you"], ready_b["you"]) == ("A", "B")
    assert (ready_a["mode"], ready_a["seq"], ready_b["seq"]) == ("remote", 1, 1)
    assert [p["id"] for p in ready_b["participants"]] == ["A", "B"]
    captions = ["utterance.received", "transcript.final", "translation.final"]
    assert [m["type"] for m in on_a] == captions
    assert [m["type"] for m in on_b] == [*captions, "tts.audio"]
    assert [m["speaker_id"] for m in on_b[:3]] == ["A", "A", "A"]
    assert (on_b[2]["listener_id"], on_b[2]["target_language"]) == ("B", "te")
    assert on_b[3]["listener_id"] == "B"
    assert {m["utterance_id"] for m in on_a + on_b} == {on_a[0]["utterance_id"]}
    assert pong["type"] == "pong"
    assert synthesizer.texts == ["Bagunnara? [te]"]


def test_the_guest_is_heard_and_voiced_on_the_host_device() -> None:
    synthesizer = FakeSynthesizer()
    client = voiced(FakeTranslator(), synthesizer)

    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            speak(b)
            on_b = [receive(b) for _ in range(3)]
            on_a = [receive(a) for _ in range(4)]
            b.send_json({"type": "ping"})
            pong = receive(b)

    assert [m["type"] for m in on_b] == [m["type"] for m in on_a[:3]]
    assert on_a[2]["listener_id"] == "A"
    assert (on_a[3]["type"], on_a[3]["listener_id"]) == ("tts.audio", "A")
    assert pong["type"] == "pong"
    assert synthesizer.texts == ["How are you? [en]"]


def test_the_speaker_is_the_device_not_the_language_heard() -> None:
    translator = FakeTranslator(language="en", text="Hello there", language_name="English")

    client = voiced(translator)
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            speak(b)
            on_a = [receive(a) for _ in range(4)]

    transcript, translation, voice = on_a[1], on_a[2], on_a[3]
    assert transcript["speaker_id"] == "B"
    assert (translation["speaker_id"], translation["listener_id"]) == ("B", "A")
    assert translation["text"] == "Hello there"
    assert (voice["type"], voice["listener_id"]) == ("tts.audio", "A")


def test_a_device_can_turn_off_the_voices_made_for_it_by_the_other_device() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")

    client = voiced(translator, synthesizer)
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            b.send_json({"type": "voice.settings", "server_voice": False})
            b.send_json({"type": "ping"})
            assert receive(b)["type"] == "pong"
            speak(a)
            on_b = [receive(b) for _ in range(3)]
            a.send_json({"type": "session.stop"})
            closed_code(a)
            left = receive(b)

    assert on_b[-1]["type"] == "translation.final"
    assert left == {"type": "peer.left", "seq": left["seq"], "participant_id": "A"}
    assert synthesizer.texts == []


@pytest.mark.parametrize("how", ["stop", "disconnect"])
def test_the_other_device_is_told_when_a_device_leaves(how: str) -> None:
    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "B") as b:
            receive(b)
            with connect(client, room, "A") as a:
                receive(a)
                if how == "stop":
                    a.send_json({"type": "session.stop"})
                else:
                    a.close()
                left = receive(b)
            b.send_json({"type": "ping"})
            pong = receive(b)

    expected = "peer.left" if how == "stop" else "peer.disconnected"
    assert (left["type"], left["participant_id"]) == (expected, "A")
    assert pong["type"] == "pong"


class GoneDevice:
    async def send(self, message_type: str, **fields) -> None:
        raise RuntimeError("Cannot call send once a close message has been sent.")

    def post(self, message_type: str, **fields) -> None:
        pass

    async def close(self, code: int) -> None:
        pass


class StalledDevice:
    def __init__(self) -> None:
        self.posted: list[str] = []

    async def send(self, message_type: str, **fields) -> None:
        await asyncio.sleep(3600)

    def post(self, message_type: str, **fields) -> None:
        self.posted.append(message_type)

    async def close(self, code: int) -> None:
        pass


def test_a_stalled_device_does_not_hold_up_the_speaker() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, synthesizer)
    stalled = StalledDevice()

    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            client.app.state.rooms.get(room["room_id"]).devices["B"] = stalled
            speak(a)
            on_a = [receive(a)["type"] for _ in range(3)]
            a.send_json({"type": "ping"})
            pong = receive(a)

    assert on_a == ["utterance.received", "transcript.final", "translation.final"]
    assert pong["type"] == "pong"
    posted = [t for t in stalled.posted if t != "speech.activity"]
    assert posted[:4] == [
        "utterance.received",
        "transcript.final",
        "translation.final",
        "tts.audio",
    ]


def test_messages_for_the_other_device_arrive_in_order_even_when_it_is_slow() -> None:
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = make_client(translator=translator)
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            for _ in range(3):
                speak(a)
            on_b = [receive(b)["type"] for _ in range(9)]

    assert on_b == ["utterance.received", "transcript.final", "translation.final"] * 3


def test_a_device_that_has_gone_away_does_not_break_the_speaker() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, synthesizer)

    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            client.app.state.rooms.get(room["room_id"]).devices["B"] = GoneDevice()
            speak(a)
            on_a = [receive(a)["type"] for _ in range(3)]
            a.send_json({"type": "ping"})
            pong = receive(a)

    assert on_a == ["utterance.received", "transcript.final", "translation.final"]
    assert pong["type"] == "pong"
    assert synthesizer.texts == ["Bagunnara? [te]"]


def test_a_room_waits_for_dropped_devices_and_is_removed_once_someone_leaves() -> None:
    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
        kept = look(client, room, room["host_token"]).status_code
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            a.send_json({"type": "session.stop"})
            closed_code(a)
            left = receive(b)
        gone = look(client, room, room["host_token"]).status_code
        with connect(client, room, "B") as b:
            error = receive(b)
            code = closed_code(b)

    assert (kept, left["type"], gone) == (200, "peer.left", 404)
    assert (error["code"], code) == ("unknown_session", 4404)


def test_a_room_that_someone_left_cannot_be_rejoined_by_the_other() -> None:
    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "B") as b:
            receive(b)
            with connect(client, room, "A") as a:
                receive(a)
                a.send_json({"type": "session.stop"})
                closed_code(a)
            receive(b)
            with connect(client, room, "A") as again:
                error = receive(again)
                code = closed_code(again)

    assert (error["code"], code) == ("unknown_session", 4404)
    assert "has ended" in error["message"]


def test_each_device_learns_who_is_connected() -> None:
    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "B") as b:
            alone = b.receive_json()
            with connect(client, room, "A") as a:
                both = a.receive_json()
                arrived = b.receive_json()
                a.close()
                dropped = b.receive_json()
            with connect(client, room, "A") as a:
                a.receive_json()
                back = b.receive_json()

    assert (alone["connected"], both["connected"]) == (["B"], ["A", "B"])
    assert [(m["type"], m["participant_id"]) for m in (arrived, dropped, back)] == [
        ("peer.connected", "A"),
        ("peer.disconnected", "A"),
        ("peer.connected", "A"),
    ]


def test_a_device_that_comes_back_takes_over_its_place() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, synthesizer)
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as old:
            [receive(ws) for ws in (a, old)]
            with connect(client, room, "B") as new:
                ready = receive(new)
                replaced = closed_code(old)
                speak(a)
                on_new = [receive(new)["type"] for _ in range(4)]

    assert (ready["type"], ready["connected"], replaced) == ("session.ready", ["A", "B"], 4410)
    assert on_new == ["utterance.received", "transcript.final", "translation.final", "tts.audio"]


def test_connecting_before_the_guest_joins_is_refused() -> None:
    client = voiced()
    with client:
        room = create(client)
        with connect(client, room, "A") as a:
            error = receive(a)
            code = closed_code(a)
        assert join(client, room).status_code == 200
        with connect(client, room, "A") as a:
            ready = receive(a)

    assert (error["code"], error["message"]) == (
        "not_joined",
        "The other person has not joined yet.",
    )
    assert code == 4409
    assert ready["type"] == "session.ready"


def test_a_wrong_token_is_refused_on_the_stream() -> None:
    client = voiced()
    with client:
        room = joined(client)
        with client.websocket_connect(f"/api/rooms/{room['room_id']}/stream?token=x") as ws:
            code = closed_code(ws)
        with client.websocket_connect(f"/api/rooms/{room['room_id']}/stream") as ws:
            missing = closed_code(ws)

    assert (code, missing) == (4401, 4401)


def test_an_unknown_room_stream_is_refused() -> None:
    client = voiced()
    with client:
        with client.websocket_connect("/api/rooms/no-such-room/stream?token=x") as ws:
            error = receive(ws)
            code = closed_code(ws)

    assert (error["code"], code) == ("unknown_session", 4404)


def test_a_device_on_the_tunnel_address_is_accepted() -> None:
    headers = {
        "Origin": f"https://{TUNNEL}",
        "Host": TUNNEL,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": "198.51.100.7",
    }

    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "B", headers) as b:
            ready = receive(b)

    assert (ready["type"], ready["you"]) == ("session.ready", "B")


def test_a_foreign_page_cannot_open_a_room_stream() -> None:
    headers = {"Origin": "https://evil.example", "Host": TUNNEL, "X-Forwarded-Proto": "https"}

    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "B", headers) as b:
            code = closed_code(b)
        with connect(client, room, "B") as b:
            ready = receive(b)

    assert code == 4403
    assert ready["type"] == "session.ready"


def test_a_device_chooses_the_voice_the_other_device_makes_for_it() -> None:
    synthesizer = FakeSynthesizer()
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, synthesizer)

    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            b.send_json({"type": "voice.settings", "server_voice": True, "voice": "Kore"})
            b.send_json({"type": "ping"})
            assert receive(b)["type"] == "pong"
            speak(a)
            on_b = [receive(b) for _ in range(4)]

    assert (on_b[-1]["type"], on_b[-1]["listener_id"]) == ("tts.audio", "B")
    assert synthesizer.requests == [("Bagunnara? [te]", "Kore")]


def test_a_device_changes_its_language_for_both_devices() -> None:
    translator = FakeTranslator(language="te", text="Bagunnara?", translation="Fine")
    client = voiced(translator, FakeSynthesizer())

    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            a.send_json({"type": "language.set", "language": "HI-in", "participant_id": "B"})
            updated_a, updated_b = receive(a), receive(b)
            speak(b)
            on_a = [receive(a) for _ in range(4)]
            looked = look(client, room, room["host_token"]).json()

    expected = [
        {"id": "A", "name": "Host", "preferred_language": "hi"},
        {"id": "B", "name": "Guest", "preferred_language": "te"},
    ]
    assert updated_a == {**updated_b, "seq": updated_a["seq"]}
    assert (updated_a["type"], updated_a["participants"]) == ("participants.updated", expected)
    assert translator.calls[-1].target_languages == ["hi", "te"]
    translation = on_a[2]
    assert (translation["listener_id"], translation["target_language"]) == ("A", "hi")
    assert translation["text"] == "Fine [hi]"
    assert looked["host"]["preferred_language"] == "hi"


@pytest.mark.parametrize(
    ("message", "detail"),
    [
        ({"language": "English"}, "'English' is not a language code."),
        ({"language": None}, "language.set needs a language code"),
        ({}, "language.set needs a language code"),
    ],
    ids=["not-a-code", "null", "missing"],
)
def test_a_bad_language_change_in_a_room_is_refused(message: dict, detail: str) -> None:
    client = voiced()

    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            a.send_json({"type": "language.set", **message})
            error = receive(a)
            b.send_json({"type": "ping"})
            on_b = receive(b)
            looked = look(client, room, room["host_token"]).json()

    assert error["code"] == "invalid_message"
    assert error["message"].startswith(detail)
    assert on_b["type"] == "pong"
    assert looked["host"]["preferred_language"] == "en"


def test_the_host_can_cancel_an_invite_before_anyone_joins(client: TestClient) -> None:
    room = create(client)

    by_host = client.delete(
        f"/api/rooms/{room['room_id']}", headers={"X-Room-Token": room["host_token"]}
    )
    again = client.delete(
        f"/api/rooms/{room['room_id']}", headers={"X-Room-Token": room["host_token"]}
    )

    assert (by_host.status_code, again.status_code) == (204, 404)
    assert join(client, room).status_code == 404


def test_a_person_who_cannot_reconnect_can_still_leave_and_the_other_is_told() -> None:
    client = voiced()
    with client:
        room = joined(client)
        with connect(client, room, "A") as a:
            receive(a)
            with connect(client, room, "B") as b:
                receive(b)
            receive(a)
            left = client.delete(
                f"/api/rooms/{room['room_id']}",
                headers={"X-Room-Token": room["guest_device_token"]},
            )
            told = receive(a)
            a.send_json({"type": "ping"})
            pong = receive(a)
        with connect(client, room, "B") as again:
            error = receive(again)
            code = closed_code(again)

    assert left.status_code == 204
    assert (told["type"], told["participant_id"], pong["type"]) == ("peer.left", "B", "pong")
    assert (error["code"], code) == ("unknown_session", 4404)


def test_a_wrong_token_cannot_end_a_room(client: TestClient) -> None:
    room = create(client)

    response = client.delete(f"/api/rooms/{room['room_id']}", headers={"X-Room-Token": "x"})

    assert response.status_code == 403
    assert look(client, room, room["host_token"]).status_code == 200


def test_the_echo_of_a_voice_played_on_the_other_device_is_ignored() -> None:
    translator = FakeTranslator(language="en", text="How are you?", translation="Bagunnara?")
    client = voiced(translator, FakeSynthesizer())
    with client:
        room = joined(client)
        with connect(client, room, "A") as a, connect(client, room, "B") as b:
            [receive(ws) for ws in (a, b)]
            speak(a)
            on_b = [receive(b) for _ in range(4)]
            [receive(a) for _ in range(3)]
            b.send_json(
                {
                    "type": "voice.played",
                    "utterance_id": on_b[0]["utterance_id"],
                    "listener_id": "A",
                    "seconds": 1.5,
                }
            )
            translator.transcripts.append("Bagunnara? [te]")
            speak(b)
            on_b_after = [receive(b)["type"] for _ in range(2)]
            on_a = [receive(a)["type"] for _ in range(2)]

    assert on_b[-1]["type"] == "tts.audio"
    assert on_b_after == ["utterance.received", "utterance.ignored"]
    assert on_a[-1] == "utterance.ignored"
