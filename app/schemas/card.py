from datetime import datetime

from pydantic import BaseModel


class DeckResponse(BaseModel):
    id: int
    language: str
    topic: str
    created_at: datetime
    card_count: int = 0
    language_card_count: int = 0


class CardCreate(BaseModel):
    deck_id: int
    word: str
    meaning: str
    native: str | None = None
    source_log_id: int | None = None


class CardUpdate(BaseModel):
    word: str
    meaning: str
    native: str = ''


class CardResponse(BaseModel):
    id: int
    deck_id: int
    word: str
    meaning: str
    native: str | None
    idempotency_key: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ImportBatchResponse(BaseModel):
    id: int
    deck_id: int
    source_file: str
    rows_parsed: int | None
    rows_inserted: int | None
    rows_skipped: int | None
    imported_at: datetime

    model_config = {"from_attributes": True}
