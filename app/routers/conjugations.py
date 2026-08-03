import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.conjugation import Conjugation
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/conjugations", tags=["conjugations"])


@router.get("/subject/{subject}")
def list_conjugations_by_subject(
    subject: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[dict]:
    decks = db.query(Deck).filter(Deck.category == "language", Deck.subject == subject).all()
    if not decks:
        raise HTTPException(status_code=404, detail="Subject not found")
    deck_ids = [d.id for d in decks]
    rows = (
        db.query(Card)
        .join(Conjugation, Card.id == Conjugation.card_id)
        .filter(Card.deck_id.in_(deck_ids), Card.is_active.is_(True))
        .order_by(Card.term)
        .all()
    )
    return [{"card_id": c.id, "term": c.term, "definition": c.definition} for c in rows]


@router.get("/{card_id}")
def get_conjugation(
    card_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    card = (
        db.query(Card)
        .join(Deck, Deck.id == Card.deck_id)
        .filter(Card.id == card_id, Card.is_active.is_(True), Deck.category == "language")
        .first()
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    conj = db.query(Conjugation).filter(Conjugation.card_id == card_id).first()
    if not conj:
        raise HTTPException(status_code=404, detail="No conjugation data for this card")

    return {"card_id": card_id, "term": card.term, **json.loads(conj.data)}
