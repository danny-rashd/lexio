from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.card import Card, Deck
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.translate import (
    SUPPORTED_CODES,
    batch_translate_to_english,
    romanize,
    split_words,
    translate_text,
)

router = APIRouter(prefix="/api/translate", tags=["translate"])


class TranslateRequest(BaseModel):
    text: str = ""
    source: str
    target: str

    @field_validator("source", "target")
    @classmethod
    def validate_lang(cls, v: str) -> str:
        if v not in SUPPORTED_CODES:
            raise ValueError(f"Unsupported language code: {v}")
        return v


@router.post("")
def translate(
    body: TranslateRequest,
    _: User = Depends(get_current_user),
) -> dict:
    if not settings.GOOGLE_TTS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation is not configured.",
        )
    if body.source == body.target:
        return {"translation": body.text}
    if not body.text.strip():
        return {"translation": ""}
    try:
        result = translate_text(body.text, body.source, body.target, settings.GOOGLE_TTS_API_KEY)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Translation error: {exc}",
        ) from exc
    return {"translation": result, "romanization": romanize(result, body.target)}


_CODE_TO_LANGUAGE = {
    "es": "spanish", "fr": "french", "de": "german",
    "no": "norsk",   "ja": "japanese", "zh": "mandarin",
}


class MineRequest(BaseModel):
    text: str
    source_code: str

    @field_validator("source_code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        if v not in _CODE_TO_LANGUAGE:
            raise ValueError(f"Unsupported language code for mining: {v}")
        return v


@router.post("/mine")
def mine_words(
    body: MineRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    if not settings.GOOGLE_TTS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation is not configured.",
        )
    language = _CODE_TO_LANGUAGE[body.source_code]
    words = split_words(body.text)
    if not words:
        return {"words": []}

    existing = {
        w.lower() for (w,) in
        db.query(Card.word)
        .join(Deck, Deck.id == Card.deck_id)
        .filter(
            Deck.language == language,
            func.lower(Card.word).in_([w.lower() for w in words]),
            Card.is_active.is_(True),
        )
        .all()
    }
    new_words = [w for w in words if w.lower() not in existing]
    if not new_words:
        return {"words": []}

    try:
        meanings = batch_translate_to_english(new_words, body.source_code, settings.GOOGLE_TTS_API_KEY)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Translation error: {exc}",
        ) from exc

    return {
        "words": [
            {"word": w, "meaning": m}
            for w, m in zip(new_words, meanings)
        ]
    }
