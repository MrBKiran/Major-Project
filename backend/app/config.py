"""
AutoSaarthi — settings.

Single source of truth for env-driven config. Everything else imports from
here instead of reading os.environ directly.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

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

    # ── environment ───────────────────────────────────────────────────────
    # "production" switches on the checks that refuse to start on unsafe
    # defaults (see app/auth/keys.py). A Literal so a typo such as
    # ENVIRONMENT=prod fails loudly at startup instead of quietly behaving like
    # development.
    environment: Literal["development", "test", "production"] = "development"

    # ── auth ──────────────────────────────────────────────────────────────
    # Required in production. In development an empty value makes the app
    # generate its own key (see app/auth/keys.py) rather than fall back to one
    # that is published in the source.
    jwt_secret: str = ""
    # Where the generated development key is kept between restarts. Empty means
    # data/.jwt_dev_key under the repo root. Never read in production.
    jwt_dev_key_file: str = ""
    access_policy_path: str = "./config/access_policy.yaml"

    # ── sign-in methods (besides email + password) ────────────────────────
    # Google Identity Services. Empty turns Google sign-in off: the button is not
    # offered and the endpoint refuses. Public by design — the browser needs it —
    # and it is also the `aud` every Google ID token must carry.
    google_client_id: str = ""
    # How one-time codes reach a phone. "console" writes the code to the server
    # log so development works without a provider account; it is refused in
    # production. "none" turns phone sign-in off.
    sms_provider: Literal["console", "twilio", "none"] = "console"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from: str = ""            # sender number, or a Messaging Service SID
    # One-time codes. Short-lived and few-attempt on purpose: six digits is a
    # million possibilities, so the limit on guesses is what protects the code.
    otp_ttl_s: int = 300
    otp_max_attempts: int = 5
    # The text of the SMS. In India the operator must have this exact template
    # registered (TRAI DLT) or the message is silently dropped — so it is
    # configuration, not code. {code} is required; {minutes} is optional.
    otp_sms_template: str = (
        "Your AutoSaarthi verification code is {code}. It expires in {minutes} minutes. "
        "Do not share this code with anyone."
    )
    # Second factor. Off by default so a fresh local checkout is not blocked by a
    # requirement nobody has set up yet; turn it on for any real deployment.
    mfa_enforcement: bool = False
    # Fernet key (urlsafe base64 of 32 random bytes) that encrypts TOTP secrets at
    # rest. Required in production. In development, empty means a key is derived from
    # JWT_SECRET — which works, but ties enrolled users' secrets to that value.
    # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    mfa_encryption_key: str = ""

    # /ws/events: how long a new connection has to present its token before it
    # is dropped, and how often an open stream re-checks that the token is still
    # good (logout, revocation, a removed role) instead of trusting it until it
    # expires.
    ws_auth_timeout_s: float = 5.0
    ws_recheck_s: float = 30.0

    # How long the refresh cookie lives — a silent re-sign-in has to happen at
    # least this often. The access token's own life is much shorter (see
    # principal.TOKEN_TTL_MINUTES); that is the point of having both.
    refresh_token_ttl_days: int = 30

    # ── cors ──────────────────────────────────────────────────────────────
    # Comma-separated origins. Defaults cover the local Vite dev server only —
    # a real deployment's frontend domain must be set via CORS_ORIGINS, not
    # hand-edited into main.py, or every environment needs a code change to
    # add its own origin.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


settings = Settings()
