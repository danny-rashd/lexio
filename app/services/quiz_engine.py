import random
from difflib import SequenceMatcher

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card, Deck
from app.models.progress import CardStat
from app.utils.text import normalize_text


def get_distractor_pool(db: Session, language: str, exclude_card_id: int) -> list[Card]:
    """
    Return a pool of cards to use as MCQ distractors.

    Args:
        db (Session): SQLAlchemy session.
        language (str): Language to prefer for distractors.
        exclude_card_id (int): Primary key of the card being tested — excluded
            from the pool so the correct answer is never a distractor.

    Returns:
        list[Card]: Active cards suitable for use as distractors. At least 3
        are needed for MCQ; the caller samples 3 from the returned list.

    Notes:
        Tries same-language pool first. If fewer than 3 same-language cards
        are available, falls back to the global card pool across all languages.
        This makes MCQ robust even for small decks.
    """
    same_lang = (
        db.query(Card)
        .join(Deck, Deck.id == Card.deck_id)
        .filter(
            Deck.language == language,
            Card.id != exclude_card_id,
            Card.is_active.is_(True),
        )
        .all()
    )
    if len(same_lang) >= 3:
        return same_lang
    return (
        db.query(Card)
        .filter(Card.id != exclude_card_id, Card.is_active.is_(True))
        .all()
    )


def select_cards_for_test(db: Session, deck_id: int, count: int) -> list[Card]:
    """
    Select cards for a single-deck Test session.

    Args:
        db (Session): SQLAlchemy session.
        deck_id (int): Target deck primary key.
        count (int): Number of cards to return.

    Returns:
        list[Card]: Randomly shuffled active cards from the deck, capped at
        count. If the deck has fewer than count active cards, all are returned.
    """
    cards = (
        db.query(Card)
        .filter(Card.deck_id == deck_id, Card.is_active.is_(True))
        .all()
    )
    random.shuffle(cards)
    return cards[:count]


def select_cards_for_big_test(
    db: Session,
    count: int,
    languages: list[str] | None = None,
    user_id: int = 1,
) -> list[Card]:
    """
    Select cards for a Total Recall session, weighted toward weakest cards.

    Args:
        db (Session): SQLAlchemy session.
        count (int): Number of cards to return.
        languages (list[str] | None): Restrict to these language names.
            None or empty list means all active languages.

    Returns:
        list[Card]: Active cards ordered by weakness score DESC, then random.
        Cards never seen rank highest (NULL weakness → nulls_first).
    """
    subq = (
        db.query(
            CardStat.card_id.label("card_id"),
            (
                1.0
                - func.sum(CardStat.times_correct)
                / func.nullif(func.sum(CardStat.times_seen), 0)
            ).label("weakness_score"),
        )
        .filter(CardStat.user_id == user_id)
        .group_by(CardStat.card_id)
        .subquery()
    )
    query = (
        db.query(Card)
        .outerjoin(subq, Card.id == subq.c.card_id)
        .filter(Card.is_active.is_(True))
    )
    if languages:
        eligible_ids = [
            row.id for row in
            db.query(Deck.id).filter(Deck.language.in_(languages)).all()
        ]
        if not eligible_ids:
            return []
        query = query.filter(Card.deck_id.in_(eligible_ids))
    return (
        query.order_by(subq.c.weakness_score.desc().nulls_first(), func.random())
        .limit(count)
        .all()
    )


def pick_direction(
    preference: str,
    card: Card,
    stats: list[CardStat] | None = None,
) -> str:
    """
    Resolve the actual quiz direction for one question.

    Args:
        preference (str): Session direction preference — one of
            '1_only', '2_only', '3_only', '4_only',
            '1_and_2', 'all_available', 'random'.
        card (Card): The card being tested. Used to check whether directions
            3 and 4 are available (requires non-empty native field).
        stats (list[CardStat] | None): Existing CardStat rows for this card.
            When provided, the weakest available direction is chosen instead
            of uniform random. Directions never attempted rank highest (1.0).

    Returns:
        str: One of 'word_to_meaning', 'meaning_to_word',
             'native_to_meaning', 'native_to_word'.

    Notes:
        Preferences 3_only and 4_only fall back to direction 1 and 2
        respectively when card.native is empty. Big Test always passes
        '1_and_2' so directions 3 and 4 are never used across languages.
    """
    has_native = bool(card.native)

    if preference == "1_only":
        return "word_to_meaning"
    if preference == "2_only":
        return "meaning_to_word"
    if preference == "3_only":
        return "native_to_meaning" if has_native else "word_to_meaning"
    if preference == "4_only":
        return "native_to_word" if has_native else "meaning_to_word"

    if preference == "1_and_2":
        available = ["word_to_meaning", "meaning_to_word"]
    else:
        available = ["word_to_meaning", "meaning_to_word"]
        if has_native:
            available += ["native_to_meaning", "native_to_word"]

    if stats is not None:
        stat_map = {s.direction: s for s in stats}

        def _weakness(direction: str) -> float:
            if direction not in stat_map:
                return 1.0
            s = stat_map[direction]
            return 1.0 if s.times_seen == 0 else 1.0 - s.times_correct / s.times_seen

        return max(available, key=_weakness)

    return random.choice(available)


def build_mcq_question(card: Card, distractors: list[Card], direction: str) -> dict:
    """
    Build one MCQ question dict with shuffled options.

    Args:
        card (Card): The card being tested.
        distractors (list[Card]): Exactly 3 distractor cards from the pool.
        direction (str): One of the 4 resolved direction values.

    Returns:
        dict: Keys — type, card_id, direction, question, options (4 items),
        correct_answer, and native (included for direction 1 when present).

    Notes:
        Options are shuffled so the correct answer appears at a random position.
        Direction 1 attaches the native field to the response for display.
    """
    if direction == "word_to_meaning":
        question = f"What does '{card.word}' mean?"
        correct = card.meaning
        options = [correct] + [d.meaning for d in distractors]
    elif direction == "meaning_to_word":
        question = f"How do you say '{card.meaning}'?"
        correct = card.word
        options = [correct] + [d.word for d in distractors]
    elif direction == "native_to_meaning":
        question = f"What does '{card.native}' mean?"
        correct = card.meaning
        options = [correct] + [d.meaning for d in distractors]
    else:
        question = f"What is the reading of '{card.native}'?"
        correct = card.word
        options = [correct] + [d.word for d in distractors]

    random.shuffle(options)

    result: dict = {
        "type": "mcq",
        "card_id": card.id,
        "direction": direction,
        "question": question,
        "options": options,
        "correct_answer": correct,
    }
    if direction == "word_to_meaning" and card.native:
        result["native"] = card.native
    return result



def build_typing_question(card: Card, direction: str) -> dict:
    """
    Build one typing prompt dict.

    Args:
        card (Card): The card whose answer the user must type.
        direction (str): One of the 4 resolved direction values.

    Returns:
        dict: Keys — type, card_id, direction, question, correct_answer, and
        native (included for direction 1 when present, shown as reading hint).

    Notes:
        correct_answer is stored as-is; normalize_text() is applied at
        evaluation time inside check_answer().
    """
    if direction == "word_to_meaning":
        question = f"Type the meaning of: {card.word}"
        correct = card.meaning
    elif direction == "meaning_to_word":
        question = f"Type the word for: {card.meaning}"
        correct = card.word
    elif direction == "native_to_meaning":
        question = f"Type the meaning of: {card.native}"
        correct = card.meaning
    else:
        question = f"Type the reading of: {card.native}"
        correct = card.word

    result: dict = {
        "type": "typing",
        "card_id": card.id,
        "direction": direction,
        "question": question,
        "correct_answer": correct,
    }
    if direction == "word_to_meaning" and card.native:
        result["native"] = card.native
    return result


def check_answer(user_answer: str, correct_answer: str, fuzzy: bool = False) -> bool:
    """
    Evaluate any answer with diacritics-insensitive, case-insensitive matching.

    Args:
        user_answer (str): Raw string from user input.
        correct_answer (str): Expected answer from the card.
        fuzzy (bool): If True, also accept difflib ratio >= TYPING_FUZZY_THRESHOLD.

    Returns:
        bool: True if the answer is accepted as correct.

    Notes:
        Both sides are normalize_text()-ed before comparison, which strips
        diacritics and lowercases. This means 'café' == 'cafe' and
        'nǐ hǎo' == 'ni hao'. Fuzzy matching is only used for typing mode.
    """
    norm_user = normalize_text(user_answer)
    norm_correct = normalize_text(correct_answer)

    if norm_user == norm_correct:
        return True

    if fuzzy:
        ratio = SequenceMatcher(None, norm_user, norm_correct).ratio()
        return ratio >= settings.TYPING_FUZZY_THRESHOLD

    return False
