from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    database_url: str = "postgresql://autosaarthi:autosaarthi123@localhost:5432/autosaarthi"
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    groq_api_key: str = ""
    gemini_api_key: str = ""
    demo_mode: bool = True
    model_dir: str = "./models"
    chroma_dir: str = "./chroma_db"
    secret_key: str = "autosaarthi-secret-2024"

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
