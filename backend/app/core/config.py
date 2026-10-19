from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Voice Translator"
    frontend_origin: str = "http://localhost:5173"
    gemini_api_key: SecretStr | None = None
    gemini_model: str | None = None
    gemini_tts_model: str | None = None
    host_key_everywhere: bool = False
    speech_timeout_seconds: float = Field(default=30.0, gt=0)


def get_settings() -> Settings:
    return Settings()
