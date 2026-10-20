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
    gemini_assistant_model: str | None = None
    host_key_everywhere: bool = False
    cloudflared_path: str | None = None
    public_url: str | None = None
    speech_timeout_seconds: float = Field(default=30.0, gt=0)
    meetings_file: Path = BACKEND_DIR / "data" / "meetings.db"
    keys_file: Path = BACKEND_DIR / "data" / "keys.db"
    guest_requests_per_minute: int = Field(default=20, ge=1)
    guest_requests_per_day: int = Field(default=400, ge=1)
    key_requests_per_minute: int = Field(default=60, ge=1)
    accounts_file: Path = BACKEND_DIR / "data" / "accounts.db"
    trainer_file: Path = BACKEND_DIR / "data" / "trainer.db"
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = Field(default=465, ge=1, le=65535)
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    mail_from: str | None = None
    user_requests_per_minute: int = Field(default=30, ge=1)
    user_requests_per_day: int = Field(default=300, ge=1)


def get_settings() -> Settings:
    return Settings()
