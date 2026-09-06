from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Campus Nexus"
    secret_key: str = "change-me-to-a-long-random-secret-in-prod"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = "sqlite:///./campus_nexus.db"
    shared_folder: str = "../shared/demo_files"
    discovery_port: int = 9999
    chunk_size: int = 1_048_576  # 1MB

    class Config:
        env_file = ".env"


settings = Settings()
