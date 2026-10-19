from datetime import UTC, datetime

import pytest

from app.models.session import Participant
from app.services.session_store import (
    LIFETIME_WITHOUT_DEVICE,
    MAX_WAITING_SESSIONS,
    SessionLimitReached,
    SessionStore,
)

PEOPLE = [
    Participant(id="B", name="Guest", preferred_language="te"),
    Participant(id="A", name="You", preferred_language="en"),
]


class Device:
    async def send(self, message_type: str, **fields) -> None:
        pass

    async def close(self, code: int) -> None:
        pass


def test_participants_are_ordered_and_a_session_can_be_found() -> None:
    store = SessionStore()
    session = store.create(PEOPLE, "together")

    assert [p.id for p in session.participants] == ["A", "B"]
    assert store.get(session.id) is session
    assert store.get("no-such-session") is None


def test_a_new_device_takes_over_and_the_old_one_is_returned() -> None:
    store = SessionStore()
    session = store.create(PEOPLE, "together")
    first, second = Device(), Device()

    assert store.connect(session, first) is None
    assert store.connect(session, second) is first
    store.disconnect(session, first, ended=True)

    assert (session.device, store.get(session.id)) == (second, session)


def test_a_dropped_session_waits_for_its_device_and_an_ended_one_is_forgotten() -> None:
    store = SessionStore()
    dropped = store.create(PEOPLE, "together")
    ended = store.create(PEOPLE, "together")
    device = Device()
    for session in (dropped, ended):
        store.connect(session, device)

    store.disconnect(dropped, device, ended=False)
    store.disconnect(ended, device, ended=True)

    assert (store.get(dropped.id), store.get(ended.id)) == (dropped, None)


def test_a_session_without_a_device_is_forgotten_after_its_lifetime() -> None:
    store = SessionStore()
    unopened = store.create(PEOPLE, "together")
    dropped = store.create(PEOPLE, "together")
    live = store.create(PEOPLE, "together")
    store.connect(dropped, Device())
    store.connect(live, Device())
    store.disconnect(dropped, dropped.device, ended=False)
    long_ago = datetime.now(UTC) - LIFETIME_WITHOUT_DEVICE * 2
    for session in (unopened, dropped, live):
        session.idle_since = long_ago

    assert [store.get(s.id) for s in (unopened, dropped, live)] == [None, None, live]


def test_waiting_sessions_are_capped() -> None:
    store = SessionStore()
    for _ in range(MAX_WAITING_SESSIONS):
        store.create(PEOPLE, "together")

    with pytest.raises(SessionLimitReached):
        store.create(PEOPLE, "together")
