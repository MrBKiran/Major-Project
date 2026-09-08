from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://autosaarthi:autosaarthi_secret@localhost:5432/autosaarthi"
    MQTT_HOST: str = "localhost"
    MQTT_PORT: int = 1883
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    CHROMA_PATH: str = "./data/chroma"
    DEMO_MODE: bool = True
    SECRET_KEY: str = "change_me"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"


settings = Settings()
