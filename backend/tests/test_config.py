from app.core.config import Settings


def test_defaults_without_env_file() -> None:
    settings = Settings(_env_file=None)

    assert settings.app_env == "development"
    assert settings.frontend_origin == "http://localhost:5173"


def test_environment_variables_override_defaults(monkeypatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:3000")

    settings = Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:3000"
