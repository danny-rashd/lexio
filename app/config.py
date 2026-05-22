from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 10080
    ADMIN_USERNAME: str
    ADMIN_PASSWORD: str
    DEMO_USERNAME: str = "demo"
    DEMO_PASSWORD: str = "demo"
    DATA_DIR: str = "./data/languages"
    TYPING_FUZZY_THRESHOLD: float = 0.85
    DEFAULT_QUIZ_CARD_COUNT: int = 20
    BIG_TEST_CARD_OPTIONS: str = "10,20,50,100"
    MAX_UPLOAD_SIZE_MB: int = 5
    MAX_UPLOAD_SIZE_APKG_MB: int = 200
    HINT_MAX_PRESSES: int = 3
    ANTHROPIC_API_KEY: str = ""
    ESSAY_MAX_WORDS: int = 500
    ESSAY_MIN_WORDS: int = 20
    GOOGLE_TTS_API_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_PUBLIC_KEY: str = ""
    VAPID_SUBJECT: str = "mailto:danny.rashd@gmail.com"

    @property
    def big_test_card_options(self) -> list[int]:
        return [int(x) for x in self.BIG_TEST_CARD_OPTIONS.split(",")]

    model_config = {"env_file": ".env"}


settings = Settings()
