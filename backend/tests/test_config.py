from pathlib import Path

from app.core.config import BACKEND_DIR, Settings


def test_defaults_without_env_file() -> None:
    settings = Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:5173"


def test_environment_variables_override_defaults(monkeypatch) -> None:
    monkeypatch.setenv("FRONTEND_ORIGIN", "http://localhost:3000")

    settings = Settings(_env_file=None)

    assert settings.frontend_origin == "http://localhost:3000"


def test_relative_data_dir_is_inside_the_backend_folder() -> None:
    assert Settings(_env_file=None).data_dir == BACKEND_DIR / "data"


def test_absolute_data_dir_is_kept(tmp_path: Path) -> None:
    assert Settings(_env_file=None, data_dir=tmp_path).data_dir == tmp_path


def test_debug_audio_is_off_by_default() -> None:
    assert Settings(_env_file=None).save_debug_audio is False


def test_env_file_is_read_from_the_backend_folder() -> None:
    assert Settings.model_config["env_file"] == BACKEND_DIR / ".env"
