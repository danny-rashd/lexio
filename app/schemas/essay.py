from datetime import datetime

from pydantic import BaseModel


class EssaySubmitRequest(BaseModel):
    language: str
    text: str


class EssayHistoryItem(BaseModel):
    id: int
    language: str
    word_count: int
    overall_score: float
    submitted_at: datetime

    model_config = {"from_attributes": True}
