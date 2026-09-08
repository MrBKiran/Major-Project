"""
AutoSaarthi — settings.

Single source of truth for env-driven config. Everything else imports from
here instead of reading os.environ directly.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute, not "./.env". A relative env_file resolves against the process's
# working directory, and the documented way to start this app is `cd backend &&
# uvicorn ...` — from there the repo-root .env simply is not found, so every
# setting silently fell back to the class defaults below rather than failing
# loudly. That is how DEMO_MODE stayed on with a real API key sitting in the
# file. Anchor to the repo root (this file is backend/app/config.py) so the same
# .env is read no matter where the process is launched from.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # llm
    groq_api_key: str = ""
    google_api_key: str = ""
    llm_primary: str = "llama-3.3-70b-versatile"
    llm_fast: str = "llama-3.1-8b-instant"
    llm_fallback: str = "gemini-2.5-flash"

    # infra
    database_url: str = "postgresql+psycopg://autosaarthi:autosaarthi@localhost:5432/autosaarthi"
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_topic_prefix: str = "fleet"
    chroma_path: str = "./data/chroma"

    # demo controls
    demo_mode: bool = True
    sim_speed: int = 43200
    prerendered_audio: bool = True

    # ueba
    ueba_enabled: bool = True
    ueba_policy_path: str = "./config/agent_policy.yaml"
    ueba_audit_path: str = "./data/audit/agent_audit.jsonl"

    # ── auth ──────────────────────────────────────────────────────────────
    # Must be set in any deployment. Empty falls back to a known dev key and
    # app.main logs a loud warning at startup — see access_policy.yaml.
    jwt_secret: str = ""
    access_policy_path: str = "./config/access_policy.yaml"

    # ── cors ──────────────────────────────────────────────────────────────
    # Comma-separated origins. Defaults cover the local Vite dev server only —
    # a real deployment's frontend domain must be set via CORS_ORIGINS, not
    # hand-edited into main.py, or every environment needs a code change to
    # add its own origin.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
