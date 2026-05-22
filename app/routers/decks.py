import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.import_log import ImportBatch
from app.models.progress import CardStat, QuizAnswer, QuizSession
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.card import DeckResponse
from app.utils.text import normalize_deck_label

router = APIRouter(prefix="/api/decks", tags=["decks"])


class DeckFindOrCreateRequest(BaseModel):
    language: str
    topic: str


def _build_deck_response(
    deck: Deck,
    card_count: int,
    language_card_count: int,
) -> DeckResponse:
    return DeckResponse(
        id=deck.id,
        language=deck.language,
        topic=deck.topic,
        created_at=deck.created_at,
        card_count=card_count,
        language_card_count=language_card_count,
    )


@router.get("", response_model=list[DeckResponse])
def list_decks(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DeckResponse]:
    decks = db.query(Deck).order_by(Deck.language, Deck.topic).all()

    per_deck_counts = dict(
        db.query(Card.deck_id, func.count(Card.id))
        .filter(Card.is_active.is_(True))
        .group_by(Card.deck_id)
        .all()
    )

    per_lang_counts = dict(
        db.query(Deck.language, func.count(Card.id))
        .join(Card, Card.deck_id == Deck.id)
        .filter(Card.is_active.is_(True))
        .group_by(Deck.language)
        .all()
    )

    return [
        _build_deck_response(
            deck,
            card_count=per_deck_counts.get(deck.id, 0),
            language_card_count=per_lang_counts.get(deck.language, 0),
        )
        for deck in decks
    ]


@router.post("", response_model=DeckResponse, status_code=status.HTTP_200_OK)
def find_or_create_deck(
    body: DeckFindOrCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DeckResponse:
    language = normalize_deck_label(body.language)
    topic    = normalize_deck_label(body.topic)
    deck = db.query(Deck).filter(Deck.language == language, Deck.topic == topic).first()
    if not deck:
        deck = Deck(language=language, topic=topic)
        db.add(deck)
        db.commit()
        db.refresh(deck)
    card_count = (
        db.query(func.count(Card.id))
        .filter(Card.deck_id == deck.id, Card.is_active.is_(True))
        .scalar() or 0
    )
    lang_count = (
        db.query(func.count(Card.id))
        .join(Deck, Deck.id == Card.deck_id)
        .filter(Deck.language == language, Card.is_active.is_(True))
        .scalar() or 0
    )
    return _build_deck_response(deck, card_count=card_count, language_card_count=lang_count)


@router.get("/{deck_id}", response_model=DeckResponse)
def get_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DeckResponse:
    deck = db.query(Deck).filter(Deck.id == deck_id).first()
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")

    card_count = (
        db.query(func.count(Card.id))
        .filter(Card.deck_id == deck_id, Card.is_active.is_(True))
        .scalar()
    )
    lang_card_count = (
        db.query(func.count(Card.id))
        .join(Deck, Deck.id == Card.deck_id)
        .filter(Deck.language == deck.language, Card.is_active.is_(True))
        .scalar()
    )
    return _build_deck_response(deck, card_count, lang_card_count)


@router.delete("/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    deck = db.query(Deck).filter(Deck.id == deck_id).first()
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")

    card_ids = [c.id for c in db.query(Card.id).filter(Card.deck_id == deck_id).all()]

    if card_ids:
        db.query(CardStat).filter(CardStat.card_id.in_(card_ids)).delete(synchronize_session=False)
        db.query(QuizAnswer).filter(QuizAnswer.card_id.in_(card_ids)).delete(synchronize_session=False)

    db.query(QuizSession).filter(QuizSession.deck_id == deck_id).update(
        {"deck_id": None}, synchronize_session=False
    )
    db.query(ImportBatch).filter(ImportBatch.deck_id == deck_id).delete(synchronize_session=False)
    db.query(Card).filter(Card.deck_id == deck_id).delete(synchronize_session=False)
    db.delete(deck)
    db.commit()


@router.get("/{deck_id}/export")
def export_deck(
    deck_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Response:
    deck = db.query(Deck).filter(Deck.id == deck_id).first()
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")

    cards = (
        db.query(Card)
        .filter(Card.deck_id == deck_id, Card.is_active.is_(True))
        .order_by(Card.id)
        .all()
    )

    buf = io.StringIO()
    exported = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    buf.write(f"# Lexio deck export\n")
    buf.write(f"# language: {deck.language}\n")
    buf.write(f"# topic: {deck.topic}\n")
    buf.write(f"# exported: {exported}\n")
    buf.write(f"# cards: {len(cards)}\n")

    writer = csv.writer(buf)
    writer.writerow(["word", "meaning", "native"])
    for card in cards:
        writer.writerow([card.word, card.meaning, card.native or ""])

    filename = f"{deck.language}_{deck.topic}.lex"
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
