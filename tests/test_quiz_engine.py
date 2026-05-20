import random
from dataclasses import dataclass, field

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.card import Card, Deck
from app.models.progress import CardStat
from app.services.quiz_engine import (
    build_mcq_question,
    build_true_false_question,
    build_typing_question,
    check_answer,
    get_distractor_pool,
    pick_direction,
    select_cards_for_big_test,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

@dataclass
class FakeCard:
    id: int
    word: str
    meaning: str
    native: str | None = None
    deck_id: int = 1


@dataclass
class FakeStat:
    direction: str
    times_seen: int
    times_correct: int
    card_id: int = 1


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


def _make_deck(db, language: str, topic: str = "basics") -> Deck:
    deck = Deck(language=language, topic=topic)
    db.add(deck)
    db.flush()
    return deck


def _make_card(db, deck: Deck, word: str, meaning: str, native: str | None = None) -> Card:
    from app.services.importer import compute_idempotency_key
    card = Card(
        deck_id=deck.id,
        word=word,
        meaning=meaning,
        native=native,
        idempotency_key=compute_idempotency_key(deck.language, deck.topic, word),
    )
    db.add(card)
    db.flush()
    return card


# ── MCQ ───────────────────────────────────────────────────────────────────────

def test_mcq_has_exactly_4_options():
    card = FakeCard(1, "hola", "hello")
    distractors = [FakeCard(2, "gracias", "thank you"), FakeCard(3, "perro", "dog"), FakeCard(4, "casa", "house")]
    q = build_mcq_question(card, distractors, "word_to_meaning")
    assert len(q["options"]) == 4


def test_mcq_correct_answer_in_options():
    card = FakeCard(1, "hola", "hello")
    distractors = [FakeCard(2, "gracias", "thank you"), FakeCard(3, "perro", "dog"), FakeCard(4, "casa", "house")]
    q = build_mcq_question(card, distractors, "word_to_meaning")
    assert q["correct_answer"] in q["options"]


def test_mcq_distractors_from_same_language(db_session):
    es = _make_deck(db_session, "spanish")
    ja = _make_deck(db_session, "japanese")
    card = _make_card(db_session, es, "hola", "hello")
    for w, m in [("gracias", "thank you"), ("perro", "dog"), ("casa", "house"), ("agua", "water")]:
        _make_card(db_session, es, w, m)
    _make_card(db_session, ja, "inu", "dog", "いぬ")
    db_session.commit()

    pool = get_distractor_pool(db_session, "spanish", card.id)
    assert all(c.deck_id == es.id for c in pool)


def test_distractor_pool_falls_back_to_global_when_same_lang_lt_3(db_session):
    es = _make_deck(db_session, "spanish")
    ja = _make_deck(db_session, "japanese")
    card = _make_card(db_session, es, "hola", "hello")
    _make_card(db_session, es, "gracias", "thank you")  # only 1 other same-lang card
    for w, m in [("inu", "dog"), ("neko", "cat"), ("mizu", "water")]:
        _make_card(db_session, ja, w, m)
    db_session.commit()

    pool = get_distractor_pool(db_session, "spanish", card.id)
    languages = {c.deck.language for c in pool}
    assert len(languages) > 1


def test_mcq_cross_language_fallback_does_not_crash(db_session):
    es = _make_deck(db_session, "spanish")
    ja = _make_deck(db_session, "japanese")
    card = _make_card(db_session, es, "hola", "hello")
    _make_card(db_session, es, "gracias", "thank you")
    for w, m in [("inu", "dog"), ("neko", "cat"), ("mizu", "water")]:
        _make_card(db_session, ja, w, m)
    db_session.commit()

    pool = get_distractor_pool(db_session, "spanish", card.id)
    distractors = random.sample(pool, min(3, len(pool)))
    q = build_mcq_question(card, distractors, "word_to_meaning")
    assert q["correct_answer"] in q["options"]


# ── True / False ──────────────────────────────────────────────────────────────

def test_true_false_distribution_roughly_50_50():
    card = FakeCard(1, "hola", "hello")
    wrong_pool = ["goodbye", "thank you", "please", "water"]
    true_count = sum(
        1
        for _ in range(100)
        for q in [build_true_false_question(card, None if random.random() < 0.5 else random.choice(wrong_pool), "word_to_meaning")]
        if q["correct_answer"] is True
    )
    assert 30 <= true_count <= 70


# ── check_answer ──────────────────────────────────────────────────────────────

def test_check_answer_exact_match():
    assert check_answer("hello", "hello") is True


def test_check_answer_diacritics_insensitive():
    assert check_answer("cafe", "café") is True
    assert check_answer("ni hao", "nǐ hǎo") is True


def test_check_answer_fuzzy_match():
    assert check_answer("helo", "hello", fuzzy=True) is True


def test_check_answer_fails_below_threshold():
    assert check_answer("completely wrong", "hello", fuzzy=True) is False


# ── pick_direction ────────────────────────────────────────────────────────────

def test_pick_direction_3_only_falls_back_to_1_without_native():
    card = FakeCard(1, "hola", "hello", native=None)
    assert pick_direction("3_only", card) == "word_to_meaning"


def test_pick_direction_4_only_falls_back_to_2_without_native():
    card = FakeCard(1, "hola", "hello", native=None)
    assert pick_direction("4_only", card) == "meaning_to_word"


def test_pick_direction_random_only_returns_valid_for_card_with_native():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    for _ in range(50):
        d = pick_direction("random", card)
        assert d in ("word_to_meaning", "meaning_to_word", "native_to_meaning", "native_to_word")


def test_pick_direction_random_excludes_native_directions_without_native():
    card = FakeCard(1, "hola", "hello", native=None)
    for _ in range(50):
        d = pick_direction("random", card)
        assert d in ("word_to_meaning", "meaning_to_word")


def test_pick_direction_with_stats_picks_weakest():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    stats = [
        FakeStat("word_to_meaning", times_seen=10, times_correct=9),
        FakeStat("meaning_to_word", times_seen=10, times_correct=2),
        FakeStat("native_to_meaning", times_seen=10, times_correct=8),
        FakeStat("native_to_word", times_seen=10, times_correct=7),
    ]
    assert pick_direction("all_available", card, stats) == "meaning_to_word"


def test_pick_direction_treats_never_attempted_as_max_weakness():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    stats = [
        FakeStat("word_to_meaning", times_seen=10, times_correct=5),
        FakeStat("meaning_to_word", times_seen=10, times_correct=5),
    ]
    d = pick_direction("all_available", card, stats)
    assert d in ("native_to_meaning", "native_to_word")


# ── Direction-specific question content ───────────────────────────────────────

def test_direction_3_shows_native_as_prompt():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    distractors = [FakeCard(2, "a", "goodbye"), FakeCard(3, "b", "thank you"), FakeCard(4, "c", "please")]
    q = build_mcq_question(card, distractors, "native_to_meaning")
    assert "こんにちは" in q["question"]
    assert "konnichiwa" not in q["question"]


def test_direction_4_shows_native_prompt_and_word_as_answer():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    distractors = [FakeCard(2, "arigatou", "ty"), FakeCard(3, "sayounara", "bye"), FakeCard(4, "hai", "yes")]
    q = build_mcq_question(card, distractors, "native_to_word")
    assert "こんにちは" in q["question"]
    assert q["correct_answer"] == "konnichiwa"


# ── Big Test ──────────────────────────────────────────────────────────────────

def test_big_test_selects_unseen_cards_first(db_session):
    es = _make_deck(db_session, "spanish")
    seen_card = _make_card(db_session, es, "hola", "hello")
    unseen_card = _make_card(db_session, es, "gracias", "thank you")
    db_session.commit()

    stat = CardStat(card_id=seen_card.id, direction="word_to_meaning", times_seen=5, times_correct=3)
    db_session.add(stat)
    db_session.commit()

    result = select_cards_for_big_test(db_session, count=2)
    assert result[0].id == unseen_card.id


def test_big_test_direction_locked_to_1_and_2():
    card = FakeCard(1, "konnichiwa", "hello", native="こんにちは")
    for _ in range(50):
        d = pick_direction("1_and_2", card)
        assert d in ("word_to_meaning", "meaning_to_word")
