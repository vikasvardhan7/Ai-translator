from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Voice Translator"
    frontend_origin: str = "http://localhost:5173"
    data_dir: Path = Path("data")
    save_debug_audio: bool = False

    @field_validator("data_dir")
    @classmethod
    def resolve_against_backend_folder(cls, path: Path) -> Path:
        return path if path.is_absolute() else BACKEND_DIR / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
