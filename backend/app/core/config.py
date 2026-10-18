"""Application settings, read from environment variables and the backend/.env file."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings for the backend. Secrets never get default values."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "AI Voice Translator"
    app_env: Literal["development", "production"] = "development"
    frontend_origin: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings instance."""
    return Settings()
