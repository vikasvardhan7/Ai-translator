import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services import retry
from app.services.account_store import AccountStore
from app.services.key_store import KeyStore
from app.services.meeting_store import MeetingStore
from app.services.public_address import PublicAddress
from app.services.trainer.store import TrainerStore
from tests.fakes import FakeMailer, FakeTranslator

FRONTEND = "http://localhost:5173"
HOST_KEY = "K7QM-4XPA-2JRT"
TEST_HOST = "localhost:8000"
THIS_COMPUTER = ("127.0.0.1", 50000)
ELSEWHERE = ("203.0.113.9", 50000)
NOT_SHOWN = {"speech.activity", "peer.connected"}


def receive(ws) -> dict:
    while (message := ws.receive_json())["type"] in NOT_SHOWN:
        pass
    return message


def make_client(
    settings: Settings | None = None,
    translator=None,
    synthesizer=None,
    client: tuple[str, int] = THIS_COMPUTER,
    mailer=None,
) -> TestClient:
    app = create_app(
        settings or Settings(_env_file=None, frontend_origin=FRONTEND),
        host_key=HOST_KEY,
        meeting_store=MeetingStore(None),
        key_store=KeyStore(None),
        account_store=AccountStore(None),
        mailer=mailer or FakeMailer(),
        trainer_store=TrainerStore(None),
    )
    app.state.speech_translator = translator
    app.state.speech_synthesizer = synthesizer
    app.state.public_address = PublicAddress(None, app_served=True)
    return TestClient(app, base_url=f"http://{TEST_HOST}", client=client)


@pytest.fixture(autouse=True)
def no_real_provider_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
        "GEMINI_TTS_MODEL",
        "GEMINI_ASSISTANT_MODEL",
        "SPEECH_TIMEOUT_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    waited: list[float] = []

    async def no_wait(seconds: float) -> None:
        waited.append(seconds)

    monkeypatch.setattr(retry, "sleep", no_wait)
    return waited


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
