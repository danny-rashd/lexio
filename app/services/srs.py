import random
from datetime import date, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.progress import CardStat

DEFAULT_EASE = 2.5
MIN_EASE = 1.3

# SM-2 quality mapping for our 4 grades
_GRADE_QUALITY = {"again": 0, "hard": 3, "good": 4, "easy": 5}


def next_review(
    grade: str,
    interval: int,
    ease_factor: float,
    repetitions: int,
) -> tuple[int, float, date, int]:
    """
    Calculate the next SRS review date using SM-2.

    Args:
        grade (str): One of 'again', 'hard', 'good', 'easy'.
        interval (int): Current interval in days.
        ease_factor (float): Current ease factor (default 2.5).
        repetitions (int): Consecutive correct SRS reviews so far.

    Returns:
        tuple: (new_interval, new_ease_factor, due_date, new_repetitions)

    Notes:
        Grade quality mapping: again=0, hard=3, good=4, easy=5.
        Quality < 3 resets the card. Quality >= 3 advances the interval.
        Ease factor floors at MIN_EASE (1.3).
    """
    q = _GRADE_QUALITY.get(grade.lower(), 0)

    if q < 3:
        new_interval = 1
        new_ef       = max(MIN_EASE, ease_factor - 0.2)
        new_reps     = 0
    else:
        if repetitions == 0:
            new_interval = 1
        elif repetitions == 1:
            new_interval = 6
        else:
            new_interval = max(1, round(interval * ease_factor))

        new_ef   = max(MIN_EASE, ease_factor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        new_reps = repetitions + 1

    due_date = date.today() + timedelta(days=new_interval)
    return new_interval, new_ef, due_date, new_reps


def count_due(db: Session, deck_id: int) -> int:
    """
    Count cards in a deck that are due for SRS review today.

    Args:
        db (Session): SQLAlchemy session.
        deck_id (int): Target deck primary key.

    Returns:
        int: Number of distinct cards with srs_due_date <= today.

    Notes:
        Only counts cards that have been reviewed at least once (srs_due_date IS NOT NULL).
        New cards are not counted as due — they become due after their first review.
    """
    today = date.today()
    return (
        db.query(func.count(func.distinct(CardStat.card_id)))
        .join(Card, Card.id == CardStat.card_id)
        .filter(
            Card.deck_id == deck_id,
            Card.is_active.is_(True),
            CardStat.srs_due_date <= today,
            CardStat.srs_due_date.isnot(None),
        )
        .scalar()
        or 0
    )


def select_due_cards(db: Session, deck_id: int, count: int) -> list[Card]:
    """
    Select cards due for SRS review from a deck.

    Args:
        db (Session): SQLAlchemy session.
        deck_id (int): Target deck primary key.
        count (int): Maximum number of cards to return.

    Returns:
        list[Card]: Cards with srs_due_date <= today, shuffled, capped at count.

    Notes:
        Only returns cards that have been previously reviewed (due_date not null).
        Cards are shuffled so the review order is not predictable.
    """
    today = date.today()
    due_card_ids = {
        row.card_id
        for row in db.query(CardStat.card_id)
        .join(Card, Card.id == CardStat.card_id)
        .filter(
            Card.deck_id == deck_id,
            Card.is_active.is_(True),
            CardStat.srs_due_date <= today,
            CardStat.srs_due_date.isnot(None),
        )
        .distinct()
        .all()
    }

    if not due_card_ids:
        return []

    cards = db.query(Card).filter(Card.id.in_(due_card_ids)).all()
    random.shuffle(cards)
    return cards[:count]
