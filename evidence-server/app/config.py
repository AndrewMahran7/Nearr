from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Server
    port: int = 8088
    log_level: str = "info"
    env: str = "development"

    # Auth
    nearr_evidence_server_key: str = "dev-key-change-me"

    # Timeouts
    request_timeout_seconds: float = 45.0
    provider_timeout_seconds: float = 20.0
    http_timeout_seconds: float = 15.0

    # Instagram
    instagram_username: Optional[str] = None
    instagram_password: Optional[str] = None
    instaloader_session_dir: str = "/data/instaloader"
    ytdlp_cookies_file: Optional[str] = None

    # Whisper
    enable_whisper: bool = False
    whisper_model: str = "base"
    whisper_device: str = "cpu"

    # Third-party profile fallback
    third_party_profile_provider: Optional[str] = None
    third_party_profile_api_key: Optional[str] = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
