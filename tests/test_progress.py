from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.card import Card, Deck
from app.models.progress import CardStat, StudyLog
from app.services.importer import compute_idempotency_key
from app.services.progress import get_streak, get_weakest_cards, log_study_day, upsert_card_stat


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


def _make_card(db, language="spanish", topic="basics", word="hola", meaning="hello") -> Card:
    deck = db.query(Deck).filter(Deck.language == language, Deck.topic == topic).first()
    if not deck:
        deck = Deck(language=language, topic=topic)
        db.add(deck)
        db.flush()
    card = Card(
        deck_id=deck.id,
        word=word,
        meaning=meaning,
        idempotency_key=compute_idempotency_key(language, topic, word),
    )
    db.add(card)
    db.commit()
    return card


def _add_log(db, days_ago: int, sessions: int = 1, cards_seen: int = 5) -> None:
    db.add(StudyLog(study_date=date.today() - timedelta(days=days_ago), sessions=sessions, cards_seen=cards_seen))
    db.commit()


# ── upsert_card_stat ──────────────────────────────────────────────────────────

def test_upsert_increments_times_seen(db_session):
    card = _make_card(db_session)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=False)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=False)
    stat = db_session.query(CardStat).filter_by(card_id=card.id, direction="word_to_meaning").first()
    assert stat.times_seen == 2


def test_upsert_increments_times_correct_only_when_correct(db_session):
    card = _make_card(db_session)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=False)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    stat = db_session.query(CardStat).filter_by(card_id=card.id, direction="word_to_meaning").first()
    assert stat.times_seen == 3
    assert stat.times_correct == 2


def test_upsert_no_duplicate_rows(db_session):
    card = _make_card(db_session)
    for _ in range(5):
        upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    count = db_session.query(CardStat).filter_by(card_id=card.id, direction="word_to_meaning").count()
    assert count == 1


def test_upsert_two_directions_produce_two_rows(db_session):
    card = _make_card(db_session)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    upsert_card_stat(db_session, card.id, "meaning_to_word", is_correct=False)
    rows = db_session.query(CardStat).filter_by(card_id=card.id).all()
    assert len(rows) == 2
    directions = {r.direction for r in rows}
    assert directions == {"word_to_meaning", "meaning_to_word"}


# ── get_weakest_cards ─────────────────────────────────────────────────────────

def test_get_weakest_cards_aggregates_across_directions(db_session):
    card = _make_card(db_session)
    upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    upsert_card_stat(db_session, card.id, "meaning_to_word", is_correct=False)

    result = get_weakest_cards(db_session)
    assert len(result) == 1
    assert result[0]["total_seen"] == 2
    assert result[0]["total_correct"] == 1


def test_get_weakest_cards_returns_weakest_direction(db_session):
    card = _make_card(db_session)
    for _ in range(4):
        upsert_card_stat(db_session, card.id, "word_to_meaning", is_correct=True)
    upsert_card_stat(db_session, card.id, "meaning_to_word", is_correct=False)

    result = get_weakest_cards(db_session)
    assert result[0]["weakest_direction"] == "meaning_to_word"


def test_get_weakest_cards_high_dir_weakness_ranked_correctly(db_session):
    good = _make_card(db_session, word="bueno", meaning="good")
    struggling = _make_card(db_session, word="malo", meaning="bad")

    for _ in range(5):
        upsert_card_stat(db_session, good.id, "word_to_meaning", is_correct=True)
    for _ in range(4):
        upsert_card_stat(db_session, good.id, "meaning_to_word", is_correct=True)
    upsert_card_stat(db_session, good.id, "meaning_to_word", is_correct=False)

    for _ in range(5):
        upsert_card_stat(db_session, struggling.id, "word_to_meaning", is_correct=True)
    for _ in range(5):
        upsert_card_stat(db_session, struggling.id, "meaning_to_word", is_correct=False)

    result = get_weakest_cards(db_session)
    assert result[0]["card_id"] == struggling.id


def test_get_weakest_cards_excludes_seen_fewer_than_twice(db_session):
    # Card seen only once should be excluded
    once = _make_card(db_session, word="hola", meaning="hello")
    upsert_card_stat(db_session, once.id, "word_to_meaning", is_correct=True)

    result = get_weakest_cards(db_session)
    card_ids = [r["card_id"] for r in result]
    assert once.id not in card_ids


def test_get_weakest_cards_ranks_worst_first(db_session):
    strong = _make_card(db_session, word="hola", meaning="hello")
    weak   = _make_card(db_session, word="gracias", meaning="thank you")

    for _ in range(4):
        upsert_card_stat(db_session, strong.id, "word_to_meaning", is_correct=True)
    for _ in range(2):
        upsert_card_stat(db_session, weak.id, "word_to_meaning", is_correct=False)

    result = get_weakest_cards(db_session)
    assert result[0]["card_id"] == weak.id


# ── log_study_day ─────────────────────────────────────────────────────────────

def test_log_study_day_creates_one_row(db_session):
    log_study_day(db_session, cards_seen=10)
    count = db_session.query(StudyLog).count()
    assert count == 1


def test_log_study_day_increments_sessions_on_repeat(db_session):
    log_study_day(db_session, cards_seen=10)
    log_study_day(db_session, cards_seen=5)
    log = db_session.query(StudyLog).first()
    assert log.sessions == 2
    assert log.cards_seen == 15


# ── get_streak ────────────────────────────────────────────────────────────────

def test_get_streak_returns_zero_with_no_logs(db_session):
    result = get_streak(db_session)
    assert result["current_streak"] == 0
    assert result["longest_streak"] == 0
    assert result["total_days"] == 0
    assert result["studied_today"] is False


def test_get_streak_consecutive_days(db_session):
    for days_ago in [0, 1, 2]:
        _add_log(db_session, days_ago)
    result = get_streak(db_session)
    assert result["current_streak"] == 3
    assert result["studied_today"] is True
    assert result["total_days"] == 3


def test_get_streak_resets_after_missed_day(db_session):
    _add_log(db_session, days_ago=0)
    _add_log(db_session, days_ago=2)  # gap: yesterday missing
    result = get_streak(db_session)
    assert result["current_streak"] == 1


def test_get_streak_longest_streak_across_gaps(db_session):
    for days_ago in [0, 1, 2, 5, 6]:
        _add_log(db_session, days_ago)
    result = get_streak(db_session)
    assert result["current_streak"] == 3
    assert result["longest_streak"] == 3
    assert result["total_days"] == 5
