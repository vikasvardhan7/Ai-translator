import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import FRONTEND, make_client
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
