from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]   # .../backend
PROJECT_DIR = BACKEND_DIR.parent                     # repo root (local runs)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BACKEND_DIR / ".env"), extra="ignore")

    app_name: str = "Campus Nexus"
    # Empty = generate a random key once and persist it in data_dir/secret_key.
    secret_key: str = ""
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'campus_nexus.db').as_posix()}"
    # Default location of the single shared root. Relative paths are resolved
    # against the project directory. The admin can move it at runtime.
    shared_folder: str = "shared/demo_files"
    # Server-private storage: upload staging, version blobs, ML history, secret.
    data_dir: str = str(BACKEND_DIR / "data")
    discovery_port: int = 9999
    chunk_size: int = 1_048_576  # 1MB
    # Comma-separated list of allowed browser origins (the Vite proxy / nginx
    # serve the UI same-origin, so this only matters for cross-origin clients).
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Comma-separated usernames that are always admins (promoted on startup/registration).
    admin_usernames: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def admin_username_set(self) -> set[str]:
        return {u.strip() for u in self.admin_usernames.split(",") if u.strip()}

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    def resolve_project_path(self, raw: str) -> Path:
        p = Path(raw)
        return p if p.is_absolute() else (PROJECT_DIR / p)


settings = Settings()
