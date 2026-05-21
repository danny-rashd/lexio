from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.card import Card, Deck
from app.models.progress import CardStat, StudyLog
from app.services.srs import DEFAULT_EASE, next_review


def upsert_card_stat(
    db: Session,
    card_id: int,
    direction: str,
    is_correct: bool,
    grade: str | None = None,
) -> None:
    """
    Increment seen/correct counts for a card+direction pair after an answer.
    When a flashcard grade is provided, also updates the SRS scheduling fields.

    Args:
        db (Session): SQLAlchemy session.
        card_id (int): Card that was just answered.
        direction (str): One of 'word_to_meaning', 'meaning_to_word',
            'native_to_meaning', 'native_to_word'.
        is_correct (bool): Whether the answer was accepted as correct.
        grade (str | None): Flashcard grade ('again','hard','good','easy').
            When provided, SM-2 is applied to update srs_* fields.

    Notes:
        Upserts on (card_id, direction). grade=None leaves SRS fields unchanged.
    """
    stat = (
        db.query(CardStat)
        .filter(CardStat.card_id == card_id, CardStat.direction == direction)
        .first()
    )
    now = datetime.now(timezone.utc)

    if stat:
        stat.times_seen += 1
        if is_correct:
            stat.times_correct += 1
        stat.last_seen_at = now
        if grade:
            new_int, new_ef, new_due, new_reps = next_review(
                grade, stat.srs_interval, stat.srs_ease_factor, stat.srs_repetitions
            )
            stat.srs_interval     = new_int
            stat.srs_ease_factor  = new_ef
            stat.srs_due_date     = new_due
            stat.srs_repetitions  = new_reps
    else:
        stat = CardStat(
            card_id=card_id,
            direction=direction,
            times_seen=1,
            times_correct=1 if is_correct else 0,
            last_seen_at=now,
        )
        if grade:
            new_int, new_ef, new_due, new_reps = next_review(grade, 1, DEFAULT_EASE, 0)
            stat.srs_interval    = new_int
            stat.srs_ease_factor = new_ef
            stat.srs_due_date    = new_due
            stat.srs_repetitions = new_reps
        db.add(stat)

    db.commit()


def get_weakest_cards(db: Session, limit: int = 20) -> list[dict]:
    """
    Return cards ranked by aggregated weakness score across all decks and directions.

    Args:
        db (Session): SQLAlchemy session.
        limit (int): Maximum number of cards to return.

    Returns:
        list[dict]: Each dict contains card info (word, meaning, native,
        language, topic), total_seen, total_correct, weakness_score (0–1),
        weakest_direction, and dir_weakness. Sorted DESC by weakness_score.

    Notes:
        Cards never seen rank highest (weakness_score = 1.0). The
        weakest_direction field identifies the single direction with the
        highest per-direction weakness, even when overall score is moderate.
        Cards never seen default weakest_direction to 'word_to_meaning'.
    """
    cards_with_decks = (
        db.query(Card, Deck.language, Deck.topic)
        .join(Deck, Deck.id == Card.deck_id)
        .filter(Card.is_active.is_(True))
        .all()
    )

    all_stats = db.query(CardStat).all()
    stats_by_card: dict[int, list[CardStat]] = {}
    for stat in all_stats:
        stats_by_card.setdefault(stat.card_id, []).append(stat)

    def _dir_weakness(stat: CardStat) -> float:
        return 1.0 if stat.times_seen == 0 else 1.0 - stat.times_correct / stat.times_seen

    results = []
    for card, language, topic in cards_with_decks:
        card_stats = stats_by_card.get(card.id, [])

        if not card_stats:
            total_seen = 0
            total_correct = 0
            weakness_score = 1.0
            weakest_direction = "word_to_meaning"
            dir_weakness = 1.0
        else:
            total_seen = sum(s.times_seen for s in card_stats)
            total_correct = sum(s.times_correct for s in card_stats)
            weakness_score = 1.0 - total_correct / total_seen if total_seen else 1.0
            weakest_stat = max(card_stats, key=_dir_weakness)
            weakest_direction = weakest_stat.direction
            dir_weakness = _dir_weakness(weakest_stat)

        results.append({
            "card_id": card.id,
            "word": card.word,
            "meaning": card.meaning,
            "native": card.native,
            "language": language,
            "topic": topic,
            "total_seen": total_seen,
            "total_correct": total_correct,
            "weakness_score": weakness_score,
            "weakest_direction": weakest_direction,
            "dir_weakness": dir_weakness,
        })

    results = [r for r in results if r["total_seen"] >= 2 and r["weakness_score"] > 0]
    results.sort(key=lambda x: (-x["weakness_score"], -x["dir_weakness"]))
    return results[:limit]


def log_study_day(db: Session, cards_seen: int) -> None:
    """
    Record or update today's study log entry.

    Args:
        db (Session): SQLAlchemy session.
        cards_seen (int): Number of cards answered in the completed session.

    Notes:
        Upserts on study_date = today (UTC). Idempotent — safe to call
        multiple times per day; increments sessions and cards_seen each call.
    """
    today = datetime.now(timezone.utc).date()
    log = db.query(StudyLog).filter(StudyLog.study_date == today).first()

    if log:
        log.sessions += 1
        log.cards_seen += cards_seen
    else:
        db.add(StudyLog(study_date=today, sessions=1, cards_seen=cards_seen))

    db.commit()


def get_streak(db: Session) -> dict:
    """
    Calculate the current and longest daily study streak.

    Args:
        db (Session): SQLAlchemy session.

    Returns:
        dict: Keys — current_streak (int), longest_streak (int),
        total_days (int), studied_today (bool).

    Notes:
        Streak is calculated in UTC calendar days. A streak breaks if any
        calendar day is missing from study_logs. The current streak counts
        backward from today; if today has no log the streak is 0.
    """
    logs = db.query(StudyLog).order_by(StudyLog.study_date).all()

    if not logs:
        return {
            "current_streak": 0, "longest_streak": 0,
            "total_days": 0, "studied_today": False,
            "studied_dates_last_30": [],
        }

    log_dates = {log.study_date for log in logs}
    today = datetime.now(timezone.utc).date()

    studied_today = today in log_dates

    current_streak = 0
    check = today
    while check in log_dates:
        current_streak += 1
        check -= timedelta(days=1)

    sorted_dates = sorted(log_dates)
    longest = cur = 1
    for i in range(1, len(sorted_dates)):
        if (sorted_dates[i] - sorted_dates[i - 1]).days == 1:
            cur += 1
            longest = max(longest, cur)
        else:
            cur = 1

    studied_dates_last_30 = sorted(
        d.isoformat()
        for d in (today - timedelta(days=i) for i in range(30))
        if d in log_dates
    )

    return {
        "current_streak": current_streak,
        "longest_streak": longest,
        "total_days": len(logs),
        "studied_today": studied_today,
        "studied_dates_last_30": studied_dates_last_30,
    }
