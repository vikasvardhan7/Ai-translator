from app.core.config import BACKEND_DIR, Settings


def test_defaults_without_env_file() -> None:
    settings = Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:5173"
    assert settings.gemini_api_key is None
    assert settings.gemini_model is None


def test_environment_variables_override_defaults(monkeypatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:3000")

    settings = Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:3000"


def test_env_file_is_read_from_the_backend_folder() -> None:
    assert Settings.model_config["env_file"] == BACKEND_DIR / ".env"
