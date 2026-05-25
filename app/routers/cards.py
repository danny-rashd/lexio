from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.card import CardCreate, CardResponse, CardUpdate
from app.services.importer import compute_idempotency_key
from app.utils.text import normalize_deck_label

router = APIRouter(prefix="/api/cards", tags=["cards"])


@router.get("", response_model=list[CardResponse])
def list_cards(
    deck_id: int,
    page: int = 1,
    size: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[CardResponse]:
    offset = (page - 1) * size
    return (
        db.query(Card)
        .filter(Card.deck_id == deck_id, Card.is_active.is_(True))
        .offset(offset)
        .limit(size)
        .all()
    )


@router.post("", response_model=CardResponse, status_code=status.HTTP_201_CREATED)
def create_card(
    body: CardCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> CardResponse:
    deck = db.query(Deck).filter(Deck.id == body.deck_id).first()
    if not deck:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deck not found")

    key = compute_idempotency_key(
        normalize_deck_label(deck.language),
        normalize_deck_label(deck.topic),
        body.word,
    )
    if db.query(Card).filter(Card.idempotency_key == key).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Card already exists")

    card = Card(
        deck_id=body.deck_id,
        word=body.word,
        meaning=body.meaning,
        native=body.native,
        idempotency_key=key,
        source_log_id=body.source_log_id,
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


@router.patch("/{card_id}", response_model=CardResponse)
def update_card(
    card_id: int,
    body: CardUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> CardResponse:
    from sqlalchemy.orm import joinedload
    card = (
        db.query(Card)
        .options(joinedload(Card.deck))
        .filter(Card.id == card_id, Card.is_active.is_(True))
        .first()
    )
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")

    if body.word != card.word:
        new_key = compute_idempotency_key(
            normalize_deck_label(card.deck.language),
            normalize_deck_label(card.deck.topic),
            body.word,
        )
        conflict = db.query(Card).filter(
            Card.idempotency_key == new_key, Card.id != card_id
        ).first()
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A card with this word already exists in this deck")
        card.idempotency_key = new_key
        card.word = body.word

    card.meaning  = body.meaning
    card.native   = body.native.strip() or None
    card.sentence = body.sentence.strip() or None
    card.ipa      = body.ipa.strip() or None
    card.notes    = body.notes.strip() or None
    db.commit()
    db.refresh(card)
    return card


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Card not found")
    card.is_active = False
    db.commit()
