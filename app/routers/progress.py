import random as _random
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.essay import EssaySubmission
from app.models.immersion import ImmersionLog
from app.models.progress import CardStat, QuizSession, StudyLog
from app.models.settings import UserSetting
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.progress import get_streak, get_weakest_cards
from app.services.srs import count_due

router = APIRouter(prefix="/api/progress", tags=["progress"])


@router.get("/weakest")
def weakest_cards(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    return get_weakest_cards(db, current_user.id, limit=limit)


@router.get("/stats")
def deck_stats(
    deck_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    deck = db.query(Deck).filter(Deck.id == deck_id).first()
    if not deck:
        return {}

    total_cards = db.query(func.count(Card.id)).filter(Card.deck_id == deck_id, Card.is_active.is_(True)).scalar()
    card_ids    = [c.id for c in db.query(Card.id).filter(Card.deck_id == deck_id, Card.is_active.is_(True)).all()]
    stats       = (
        db.query(CardStat)
        .filter(CardStat.user_id == current_user.id, CardStat.card_id.in_(card_ids))
        .all()
    ) if card_ids else []

    cards_seen    = len({s.card_id for s in stats})
    total_seen    = sum(s.times_seen for s in stats)
    total_correct = sum(s.times_correct for s in stats)
    correct_rate  = round(total_correct / total_seen, 4) if total_seen else 0.0

    return {
        "deck_id":      deck.id,
        "language":     deck.language,
        "topic":        deck.topic,
        "total_cards":  total_cards,
        "cards_seen":   cards_seen,
        "total_seen":   total_seen,
        "total_correct": total_correct,
        "correct_rate": correct_rate,
        "due_count":    count_due(db, deck.id, user_id=current_user.id),
    }


@router.get("/streak")
def streak(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return get_streak(db, current_user.id)


@router.get("/daily-activity")
def daily_activity(
    days: int = Query(default=91, ge=7, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    today = date.today()
    start = today - timedelta(days=days - 1)

    study_logs     = db.query(StudyLog).filter(
        StudyLog.user_id == current_user.id, StudyLog.study_date >= start
    ).all()
    immersion_logs = db.query(ImmersionLog).filter(
        ImmersionLog.user_id == current_user.id,
        func.date(ImmersionLog.logged_at) >= start,
    ).all()
    essay_subs     = db.query(EssaySubmission).filter(
        EssaySubmission.user_id == current_user.id,
        func.date(EssaySubmission.submitted_at) >= start,
    ).all()

    result: dict[str, dict] = {}

    def _day(d: object) -> str:
        return str(d) if isinstance(d, date) else str(d)[:10]

    for log in study_logs:
        d = _day(log.study_date)
        result.setdefault(d, {"cards": 0, "quiz_sessions": 0, "immersion_minutes": 0, "essays": 0, "immersion_detail": []})
        result[d]["cards"]         = log.cards_seen
        result[d]["quiz_sessions"] = log.sessions

    for im in immersion_logs:
        d = _day(im.logged_at.date())
        result.setdefault(d, {"cards": 0, "quiz_sessions": 0, "immersion_minutes": 0, "essays": 0, "immersion_detail": []})
        result[d]["immersion_minutes"] += im.duration_minutes
        result[d]["immersion_detail"].append(f"{im.resource} ({_fmt_mins(im.duration_minutes)})" if im.resource else f"{_fmt_mins(im.duration_minutes)}")

    for essay in essay_subs:
        d = _day(essay.submitted_at.date())
        result.setdefault(d, {"cards": 0, "quiz_sessions": 0, "immersion_minutes": 0, "essays": 0, "immersion_detail": []})
        result[d]["essays"] += 1

    return {"days": result, "start": str(start), "end": str(today)}


def _fmt_mins(mins: int) -> str:
    h, m = divmod(mins, 60)
    return f"{h}h{m:02d}m" if h and m else (f"{h}h" if h else f"{m}m")


def _hidden_deck_ids(db: Session, user_id: int) -> set[int]:
    import json as _json
    setting = db.query(UserSetting).filter(
        UserSetting.user_id == user_id, UserSetting.key == "hidden_languages"
    ).first()
    hidden_langs = set(_json.loads(setting.value)) if setting else set()
    if not hidden_langs:
        return set()
    return {
        row[0] for row in
        db.query(Deck.id).filter(Deck.language.in_(hidden_langs)).all()
    }


@router.get("/due-forecast")
def due_forecast(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    """
    Return how many SRS cards are due on each of the next 7 days.

    Args:
        db (Session): Database session.
        current_user (User): Authenticated user.

    Returns:
        list[dict]: Seven entries with keys 'date', 'label', 'count'.

    Notes:
        Today's count includes all overdue cards (due_date <= today).
        Future days show only cards scheduled for exactly that date.
    """
    today = date.today()
    hidden_ids = _hidden_deck_ids(db, current_user.id)
    result = []
    for i in range(7):
        d = today + timedelta(days=i)
        base = (
            db.query(func.count(func.distinct(CardStat.card_id)))
            .join(Card, Card.id == CardStat.card_id)
            .filter(
                CardStat.user_id == current_user.id,
                Card.is_active.is_(True),
                CardStat.srs_due_date.isnot(None),
            )
        )
        if hidden_ids:
            base = base.filter(Card.deck_id.not_in(hidden_ids))
        if i == 0:
            count = base.filter(CardStat.srs_due_date <= d).scalar() or 0
            label = "Today"
        else:
            count = base.filter(CardStat.srs_due_date == d).scalar() or 0
            label = d.strftime("%a")
        result.append({"date": str(d), "label": label, "count": count})
    return result


@router.get("/word-of-day")
def word_of_day(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Return a single featured card for today, stable across requests.

    Args:
        db (Session): Database session.
        current_user (User): Authenticated user.

    Returns:
        dict: Card fields plus 'language', 'topic', 'reason' (overdue/due/weak/new).
              Empty dict if no cards exist.

    Notes:
        Priority: overdue → due today → weakest seen → random active card.
        Deterministic within a calendar day via a seeded RNG keyed on user_id + date.
    """
    today = date.today()
    rng = _random.Random(current_user.id * 10000 + today.toordinal())
    hidden_ids = _hidden_deck_ids(db, current_user.id)

    def _card_ids_filtered(*filters):
        q = (
            db.query(CardStat.card_id)
            .join(Card, Card.id == CardStat.card_id)
            .filter(CardStat.user_id == current_user.id, Card.is_active.is_(True))
        )
        if hidden_ids:
            q = q.filter(Card.deck_id.not_in(hidden_ids))
        for f in filters:
            q = q.filter(f)
        return list({row[0] for row in q.all()})

    def _build(card_id: int, reason: str) -> dict:
        card = db.query(Card).filter(Card.id == card_id).first()
        deck = db.query(Deck).filter(Deck.id == card.deck_id).first()
        return {
            "card_id":  card.id,
            "deck_id":  card.deck_id,
            "word":     card.word,
            "meaning":  card.meaning,
            "native":   card.native,
            "ipa":      card.ipa,
            "language": deck.language if deck else "",
            "topic":    deck.topic if deck else "",
            "reason":   reason,
        }

    overdue_ids = _card_ids_filtered(
        CardStat.srs_due_date < today, CardStat.srs_due_date.isnot(None)
    )
    if overdue_ids:
        return _build(rng.choice(overdue_ids), "overdue")

    due_ids = _card_ids_filtered(CardStat.srs_due_date == today)
    if due_ids:
        return _build(rng.choice(due_ids), "due")

    weakest = get_weakest_cards(db, current_user.id, limit=10)
    if weakest:
        visible = [w for w in weakest if w.get("card_id") and
                   db.query(Card.deck_id).filter(Card.id == w["card_id"]).scalar() not in hidden_ids]
        if visible:
            chosen = rng.choice(visible[:min(5, len(visible))])
            return _build(chosen["card_id"], "weak")

    visible_all = [
        row[0] for row in db.query(Card.id)
        .filter(Card.is_active.is_(True))
        .filter(Card.deck_id.not_in(hidden_ids) if hidden_ids else True)
        .all()
    ]
    if not visible_all:
        return {}
    return _build(rng.choice(visible_all), "new")


@router.get("/dashboard")
def dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    today       = date.today()
    streak_data = get_streak(db, current_user.id)
    top_weakest = get_weakest_cards(db, current_user.id, limit=5)

    lang_rows = (
        db.query(Deck.language, func.count(Card.id).label("total_cards"))
        .join(Card, Card.deck_id == Deck.id)
        .filter(Card.is_active.is_(True))
        .group_by(Deck.language)
        .all()
    )

    all_stats = db.query(CardStat).filter(CardStat.user_id == current_user.id).all()
    stats_by_card: dict[int, list[CardStat]] = {}
    for s in all_stats:
        stats_by_card.setdefault(s.card_id, []).append(s)

    lang_card_ids: dict[str, list[int]] = {}
    deck_by_id: dict[int, Deck] = {}
    for card in db.query(Card).filter(Card.is_active.is_(True)).all():
        if card.deck_id not in deck_by_id:
            deck_by_id[card.deck_id] = db.query(Deck).filter(Deck.id == card.deck_id).first()
        deck = deck_by_id[card.deck_id]
        if deck:
            lang_card_ids.setdefault(deck.language, []).append(card.id)

    # Quiz cards answered per language (finished sessions for this user)
    quiz_cards_by_lang: dict[str, int] = {}
    sessions = (
        db.query(QuizSession, Deck)
        .join(Deck, QuizSession.deck_id == Deck.id)
        .filter(QuizSession.user_id == current_user.id, QuizSession.finished_at.isnot(None))
        .all()
    )
    for sess, deck in sessions:
        quiz_cards_by_lang[deck.language] = quiz_cards_by_lang.get(deck.language, 0) + sess.total

    languages = []
    for language, total_cards in lang_rows:
        cids       = lang_card_ids.get(language, [])
        lang_stats = [s for cid in cids for s in stats_by_card.get(cid, [])]
        total_seen    = sum(s.times_seen    for s in lang_stats)
        total_correct = sum(s.times_correct for s in lang_stats)
        cards_seen    = len({s.card_id for s in lang_stats})

        dir_agg: dict[str, dict] = {}
        for s in lang_stats:
            if s.direction not in dir_agg:
                dir_agg[s.direction] = {"seen": 0, "correct": 0}
            dir_agg[s.direction]["seen"]    += s.times_seen
            dir_agg[s.direction]["correct"] += s.times_correct
        directions = {
            d: {
                "seen":    v["seen"],
                "correct": v["correct"],
                "rate":    round(v["correct"] / v["seen"], 4) if v["seen"] else 0.0,
            }
            for d, v in dir_agg.items()
        }

        new_c = learning_c = mature_c = overdue_c = 0
        for cid in cids:
            srs_rows = [s for s in stats_by_card.get(cid, []) if s.srs_due_date is not None]
            if not srs_rows:
                new_c += 1
            elif any(s.srs_due_date < today for s in srs_rows):
                overdue_c += 1
            elif max(s.srs_interval for s in srs_rows) >= 21:
                mature_c += 1
            else:
                learning_c += 1

        languages.append({
            "language":         language,
            "total_cards":      total_cards,
            "cards_seen":       cards_seen,
            "total_seen":       total_seen,
            "correct_rate":     round(total_correct / total_seen, 4) if total_seen else 0.0,
            "directions":       directions,
            "srs_health":       {"new": new_c, "learning": learning_c, "mature": mature_c, "overdue": overdue_c},
            "quiz_cards_total": quiz_cards_by_lang.get(language, 0),
        })

    return {
        "streak":        streak_data,
        "weakest_cards": top_weakest,
        "languages":     languages,
    }
