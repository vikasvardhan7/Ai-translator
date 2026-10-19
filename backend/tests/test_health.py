import logging

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import HideSecrets, create_app
from tests.conftest import FRONTEND, TEST_HOST, THIS_COMPUTER, VALID_BODY, make_client
from tests.fakes import FakeSynthesizer, FakeTranslator


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cors_allows_the_frontend_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": FRONTEND})

    assert response.headers["access-control-allow-origin"] == FRONTEND


def test_cors_blocks_other_origins(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "http://evil.example"})

    assert "access-control-allow-origin" not in response.headers


def test_unexpected_errors_return_json_detail() -> None:
    app = create_app(Settings(_env_file=None))

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    response = TestClient(app, raise_server_exceptions=False).get("/boom")

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error."}


def test_shutdown_closes_the_speech_and_voice_services() -> None:
    translator = FakeTranslator()
    synthesizer = FakeSynthesizer()

    with make_client(translator=translator, synthesizer=synthesizer):
        assert (translator.closed, synthesizer.closed) == (False, False)

    assert (translator.closed, synthesizer.closed) == (True, True)


def test_a_failed_close_still_closes_the_other_service() -> None:
    class FailingClose(FakeTranslator):
        async def aclose(self) -> None:
            raise RuntimeError("close failed")

    synthesizer = FakeSynthesizer()

    with pytest.raises(RuntimeError):
        with make_client(translator=FailingClose(), synthesizer=synthesizer):
            pass

    assert synthesizer.closed is True


def test_the_built_frontend_is_served_beside_the_api(tmp_path) -> None:
    (tmp_path / "index.html").write_text("<main>app</main>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("start()")
    client = TestClient(
        create_app(Settings(_env_file=None), frontend_dist=tmp_path),
        base_url=f"http://{TEST_HOST}",
        client=THIS_COMPUTER,
    )

    assert client.get("/").text == "<main>app</main>"
    assert client.get("/assets/app.js").text == "start()"
    assert client.get("/missing.js").status_code == 404
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/docs").status_code == 200
    assert client.post("/api/sessions", json=VALID_BODY).status_code == 201
    assert client.post("/api/rooms", json={"consent": False}).status_code == 422


def test_without_a_built_frontend_only_the_api_is_served(tmp_path) -> None:
    client = TestClient(create_app(Settings(_env_file=None), frontend_dist=tmp_path / "dist"))

    assert client.get("/").status_code == 404
    assert client.get("/health").status_code == 200


@pytest.mark.parametrize(
    ("address", "shown"),
    [
        ("/api/rooms/r1/stream?token=abc-123_X", "/api/rooms/r1/stream?token=hidden"),
        ("/api/sessions/7c9e-6679/stream", "/api/sessions/hidden/stream"),
        ("/health", "/health"),
    ],
    ids=["room-token", "session-id", "nothing-secret"],
)
def test_server_logs_do_not_show_tokens_or_session_ids(address: str, shown: str) -> None:
    record = logging.LogRecord(
        "uvicorn.error",
        logging.INFO,
        "",
        0,
        '%s - "WebSocket %s" [accepted]',
        ("me", address),
        None,
    )

    HideSecrets().filter(record)

    assert record.getMessage() == f'me - "WebSocket {shown}" [accepted]'
