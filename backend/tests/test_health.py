from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_client() -> TestClient:
    settings = Settings(_env_file=None, frontend_origin="http://localhost:5173")
    return TestClient(create_app(settings))


def test_health_returns_ok() -> None:
    response = make_client().get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cors_allows_the_frontend_origin() -> None:
    response = make_client().get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_blocks_other_origins() -> None:
    response = make_client().get("/health", headers={"Origin": "http://evil.example"})

    assert "access-control-allow-origin" not in response.headers
