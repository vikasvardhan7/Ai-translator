import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.fakes import FakeTranslator

FRONTEND = "http://localhost:5173"


def receive(ws) -> dict:
    while (message := ws.receive_json())["type"] == "speech.activity":
        pass
    return message


def make_client(settings: Settings | None = None, translator=None, synthesizer=None) -> TestClient:
    app = create_app(settings or Settings(_env_file=None, frontend_origin=FRONTEND))
    app.state.speech_translator = translator
    app.state.speech_synthesizer = synthesizer
    return TestClient(app)


@pytest.fixture(autouse=True)
def no_real_provider_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_TTS_MODEL", "SPEECH_TIMEOUT_SECONDS"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def translator() -> FakeTranslator:
    return FakeTranslator()


@pytest.fixture
def client(translator: FakeTranslator) -> TestClient:
    return make_client(translator=translator)


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
