import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

FRONTEND = "http://localhost:5173"


@pytest.fixture
def client() -> TestClient:
    settings = Settings(_env_file=None, frontend_origin=FRONTEND)
    return TestClient(create_app(settings))


VALID_BODY = {
    "consent": True,
    "participants": [
        {"id": "A", "name": "Person A", "preferred_language": "en"},
        {"id": "B", "name": "Person B", "preferred_language": "te"},
    ],
}


@pytest.fixture
def session_id(client: TestClient) -> str:
    response = client.post("/api/sessions", json=VALID_BODY)
    assert response.status_code == 201
    return response.json()["session_id"]
