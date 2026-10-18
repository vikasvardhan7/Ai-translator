import copy
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.services import session_store
from tests.conftest import VALID_BODY


def body(**changes):
    data = copy.deepcopy(VALID_BODY)
    data.update(changes)
    return data


def test_create_session_returns_id_and_participants(client: TestClient) -> None:
    response = client.post("/api/sessions", json=VALID_BODY)

    assert response.status_code == 201
    data = response.json()
    assert len(data["session_id"]) == 36
    assert [p["id"] for p in data["participants"]] == ["A", "B"]
    assert data["participants"][1]["preferred_language"] == "te"
    created_at = datetime.fromisoformat(data["created_at"])
    assert created_at.tzinfo is not None


def test_participants_are_returned_in_id_order(client: TestClient) -> None:
    reversed_body = body(participants=list(reversed(VALID_BODY["participants"])))

    response = client.post("/api/sessions", json=reversed_body)

    assert [p["id"] for p in response.json()["participants"]] == ["A", "B"]


def test_consent_is_required(client: TestClient) -> None:
    response = client.post("/api/sessions", json=body(consent=False))

    assert response.status_code == 422
    assert "agree" in response.text


def test_text_that_is_not_a_language_code_is_rejected(client: TestClient) -> None:
    bad = body()
    bad["participants"][0]["preferred_language"] = "Telugu"

    response = client.post("/api/sessions", json=bad)

    assert response.status_code == 422
    assert "not a language code" in response.text


@pytest.mark.parametrize(("given", "stored"), [("yue", "yue"), ("TE", "te"), ("pt-BR", "pt")])
def test_any_language_code_is_accepted(client: TestClient, given: str, stored: str) -> None:
    good = body()
    good["participants"][0]["preferred_language"] = given

    response = client.post("/api/sessions", json=good)

    assert response.status_code == 201
    assert response.json()["participants"][0]["preferred_language"] == stored


def test_duplicate_participant_ids_are_rejected(client: TestClient) -> None:
    bad = body()
    bad["participants"][1]["id"] = "A"

    response = client.post("/api/sessions", json=bad)

    assert response.status_code == 422
    assert "'A' and 'B'" in response.text


def test_exactly_two_participants(client: TestClient) -> None:
    one = body(participants=VALID_BODY["participants"][:1])

    assert client.post("/api/sessions", json=one).status_code == 422


def test_empty_or_long_name_is_rejected(client: TestClient) -> None:
    empty = body()
    empty["participants"][0]["name"] = "   "
    long = body()
    long["participants"][0]["name"] = "x" * 41

    assert client.post("/api/sessions", json=empty).status_code == 422
    assert client.post("/api/sessions", json=long).status_code == 422


def test_unknown_fields_are_rejected(client: TestClient) -> None:
    response = client.post("/api/sessions", json=body(api_key="leak"))

    assert response.status_code == 422


def test_validation_errors_are_one_readable_sentence(client: TestClient) -> None:
    bad = body(consent=False)
    bad["participants"][0]["preferred_language"] = "Telugu"

    response = client.post("/api/sessions", json=bad)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert isinstance(detail, str)
    assert "not a language code" in detail
    assert "Value error" not in detail


def test_too_many_waiting_sessions_are_refused(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(session_store, "MAX_UNOPENED_SESSIONS", 1)
    assert client.post("/api/sessions", json=body()).status_code == 201

    response = client.post("/api/sessions", json=body())

    assert response.status_code == 503
    assert "Too many sessions" in response.json()["detail"]
