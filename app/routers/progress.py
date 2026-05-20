from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.progress import CardStat
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.progress import get_streak, get_weakest_cards

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/weakest")
def weakest_cards(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[dict]:
    return get_weakest_cards(db, limit=limit)


@router.get("/stats")
def deck_stats(
    deck_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    deck = db.query(Deck).filter(Deck.id == deck_id).first()
    if not deck:
        return {}

    total_cards = db.query(func.count(Card.id)).filter(Card.deck_id == deck_id, Card.is_active.is_(True)).scalar()

    card_ids = [c.id for c in db.query(Card.id).filter(Card.deck_id == deck_id, Card.is_active.is_(True)).all()]
    stats = db.query(CardStat).filter(CardStat.card_id.in_(card_ids)).all() if card_ids else []

    cards_seen = len({s.card_id for s in stats})
    total_seen = sum(s.times_seen for s in stats)
    total_correct = sum(s.times_correct for s in stats)
    correct_rate = round(total_correct / total_seen, 4) if total_seen else 0.0

    return {
        "deck_id": deck.id,
        "language": deck.language,
        "topic": deck.topic,
        "total_cards": total_cards,
        "cards_seen": cards_seen,
        "total_seen": total_seen,
        "total_correct": total_correct,
        "correct_rate": correct_rate,
    }


@router.get("/streak")
def streak(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    return get_streak(db)


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    streak_data = get_streak(db)
    top_weakest = get_weakest_cards(db, limit=5)

    lang_rows = (
        db.query(Deck.language, func.count(Card.id).label("total_cards"))
        .join(Card, Card.deck_id == Deck.id)
        .filter(Card.is_active.is_(True))
        .group_by(Deck.language)
        .all()
    )

    all_stats = db.query(CardStat).all()
    stats_by_card: dict[int, list[CardStat]] = {}
    for s in all_stats:
        stats_by_card.setdefault(s.card_id, []).append(s)

    lang_card_ids: dict[str, list[int]] = {}
    for card in db.query(Card).filter(Card.is_active.is_(True)).all():
        deck = db.query(Deck).filter(Deck.id == card.deck_id).first()
        if deck:
            lang_card_ids.setdefault(deck.language, []).append(card.id)

    languages = []
    for language, total_cards in lang_rows:
        cids = lang_card_ids.get(language, [])
        lang_stats = [s for cid in cids for s in stats_by_card.get(cid, [])]
        total_seen = sum(s.times_seen for s in lang_stats)
        total_correct = sum(s.times_correct for s in lang_stats)
        languages.append({
            "language": language,
            "total_cards": total_cards,
            "total_seen": total_seen,
            "correct_rate": round(total_correct / total_seen, 4) if total_seen else 0.0,
        })

    return {
        "streak": streak_data,
        "weakest_cards": top_weakest,
        "languages": languages,
    }
