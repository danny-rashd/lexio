from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.card import DeckResponse

router = APIRouter(prefix="/api/decks", tags=["decks"])


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
    db.query(Card).filter(Card.deck_id == deck_id).update({"is_active": False})
    db.commit()
