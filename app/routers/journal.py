from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.card import Card, Deck
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.text_parser import _normalise, parse_text

router = APIRouter(prefix="/api/journal", tags=["journal"])

_SUPPORTED_LANGUAGES = {"spanish", "french", "german", "norsk", "mandarin", "japanese"}


class ParseTextRequest(BaseModel):
    text: str
    language: str


@router.post("/parse-text")
def parse_text_endpoint(
    body: ParseTextRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    language = body.language.lower().strip()
    text     = body.text.strip()

    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")
    if len(text) > 5000:
        raise HTTPException(status_code=400, detail="Text too long. Maximum 5000 characters.")
    if language not in _SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {language}")

    cjk_languages = {"mandarin", "japanese"}
    if language in cjk_languages and not settings.DEEPSEEK_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Text parsing for CJK languages requires DEEPSEEK_API_KEY to be configured.",
        )

    # Fetch all normalised terms in this subject to flag known words
    deck_ids = [
        d.id for d in db.query(Deck).filter(Deck.category == "language", Deck.subject == language).all()
    ]
    existing_words: set[str] = set()
    if deck_ids:
        cards = db.query(Card.term).filter(
            Card.deck_id.in_(deck_ids), Card.is_active.is_(True)
        ).all()
        existing_words = {_normalise(c.term) for c in cards}

    try:
        result = parse_text(text, language, existing_words)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Parsing failed: {exc}") from exc

    return {
        "language": language,
        "new":      result["new"],
        "known":    result["known"],
        "cjk":      result["cjk"],
        "total":    len(result["new"]) + len(result["known"]),
    }
