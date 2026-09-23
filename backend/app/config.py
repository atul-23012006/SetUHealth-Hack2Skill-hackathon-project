from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str = ""
    # Primary model, and one to fail over to when the primary is overloaded or
    # times out (Google sheds load per model). Set the fallback empty to disable.
    gemini_model: str = "gemini-3.6-flash"
    gemini_fallback_model: str = "gemini-3-flash-preview"
    cors_origins: list[str] = ["*"]
    # Public-data feeds (weather, World Bank, OpenStreetMap). Set LIVE_DATA_ENABLED=false
    # for fully offline demos; the /api/live endpoints then return 503.
    live_data_enabled: bool = True
    # Keep fetched live data in SQLite so a restart (or a flaky upstream) still has something real to show.
    live_cache_persist: bool = True
    # Push alerts when a real weather signal turns "high" (see services/signal_alerts.py).
    signal_polling_enabled: bool = True
    signal_poll_minutes: int = 30
    # Optional: POST each alert here as JSON. Slack/Teams-compatible (has a "text" field).
    alert_webhook_url: str = ""
    # Authentication. "demo" keeps the original X-User-Id picker (fine for a demo,
    # unsafe anywhere real). "token" requires a login: passwords are scrypt-hashed
    # in SQLite, sessions are short-lived signed JWTs, and every console route
    # needs one. In token mode set JWT_SECRET (else an ephemeral one is generated
    # and sessions end on restart) and DEMO_USER_PASSWORD (else one is generated
    # and logged once).
    # SQLite ledger location (default: next to the generated dataset). Point it elsewhere for an isolated database.
    db_path: str = ""
    auth_mode: str = "demo"
    jwt_secret: str = ""
    token_ttl_hours: int = 8
    demo_user_password: str = ""
    # data.gov.in Open Government Data (OGD) API. The default below is the
    # public sample key data.gov.in itself publishes at
    # https://api.data.gov.in/ for trying its API without registering — not a
    # secret, and rate-limited to a small public catalog. Set your own key
    # (free at data.gov.in) for higher limits or a broader dataset.
    data_gov_in_api_key: str = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"

    class Config:
        env_file = ".env"


settings = Settings()
