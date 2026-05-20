from pydantic import BaseModel


class QuizStartRequest(BaseModel):
    scope: str
    deck_id: int | None = None
    mode: str
    direction: str = "1_and_2"
    card_count: int = 20


class QuizAnswerRequest(BaseModel):
    card_id: int
    direction: str
    user_answer: str | None = None
    correct_answer: str | None = None


class HintRequest(BaseModel):
    correct_answer: str
    revealed: list[int] = []
    direction: str = "word_to_meaning"


class HintResponse(BaseModel):
    revealed: list[int]
    masked: str | None = None
    show_full_reading: bool = False
