from datetime import UTC, datetime

import pytest

from app.models.session import Participant
from app.services.session_store import (
    MAX_UNOPENED_SESSIONS,
    UNOPENED_SESSION_LIFETIME,
    SessionLimitReached,
    SessionStore,
)

PEOPLE = [
    Participant(id="B", name="Guest", preferred_language="te"),
    Participant(id="A", name="You", preferred_language="en"),
]


def test_participants_are_ordered_and_a_session_is_taken_once() -> None:
    store = SessionStore()
    session = store.create(PEOPLE, "together")

    assert [p.id for p in session.participants] == ["A", "B"]
    assert store.take(session.id) is session
    assert store.take(session.id) is None


def test_unopened_sessions_expire_and_are_dropped() -> None:
    store = SessionStore()
    old = store.create(PEOPLE, "together")
    old.created_at = datetime.now(UTC) - UNOPENED_SESSION_LIFETIME * 2
    other = store.create(PEOPLE, "together")

    assert old.id not in store._unopened
    assert store.take(other.id) is other


def test_an_expired_session_cannot_be_opened() -> None:
    store = SessionStore()
    session = store.create(PEOPLE, "together")
    session.created_at = datetime.now(UTC) - UNOPENED_SESSION_LIFETIME * 2

    assert store.take(session.id) is None


def test_opening_any_session_drops_expired_ones() -> None:
    store = SessionStore()
    old = store.create(PEOPLE, "together")
    fresh = store.create(PEOPLE, "together")
    old.created_at = datetime.now(UTC) - UNOPENED_SESSION_LIFETIME * 2

    assert store.take(fresh.id) is fresh
    assert old.id not in store._unopened


def test_waiting_sessions_are_capped() -> None:
    store = SessionStore()
    for _ in range(MAX_UNOPENED_SESSIONS):
        store.create(PEOPLE, "together")

    with pytest.raises(SessionLimitReached):
        store.create(PEOPLE, "together")
