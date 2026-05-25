import json
import random
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.progress import CardStat, QuizAnswer, QuizSession
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.quiz import HintRequest, HintResponse, QuizAnswerRequest, QuizStartRequest
from app.services.progress import log_study_day, upsert_card_stat
from app.services.srs import select_due_cards
from app.services.quiz_engine import (
    build_mcq_question,
    build_typing_question,
    check_answer,
    get_distractor_pool,
    pick_direction,
    select_cards_for_big_test,
    select_cards_for_test,
)
from app.utils.hint import first_and_last, generate_letter_mask, next_reveal

router = APIRouter(prefix="/api/quiz", tags=["quiz"])

_VALID_MODES = {"mcq", "typing", "flashcard", "cloze"}
_VALID_SCOPES = {"test", "big_test", "review"}
_VALID_DIRECTIONS = {"1_only", "2_only", "3_only", "4_only", "1_and_2", "all_available", "random"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _answered_ids(db: Session, session_id: int) -> set[int]:
    return {
        row.card_id
        for row in db.query(QuizAnswer.card_id)
        .filter(QuizAnswer.session_id == session_id)
        .all()
    }


def _next_card(db: Session, session: QuizSession, answered: set[int]) -> Card | None:
    if len(answered) >= session.total:
        return None

    query = db.query(Card).filter(Card.is_active.is_(True))
    if session.mode == "cloze":
        query = query.filter(Card.sentence.isnot(None))
    if session.scope == "test":
        query = query.filter(Card.deck_id == session.deck_id)
    elif session.scope == "big_test" and session.language_filter:
        languages = json.loads(session.language_filter)
        eligible = [
            row[0] for row in
            db.query(Deck.id).filter(Deck.language.in_(languages)).all()
        ]
        if eligible:
            query = query.filter(Card.deck_id.in_(eligible))
    if answered:
        query = query.filter(Card.id.not_in(answered))

    return query.order_by(func.random()).first()


def _card_language(db: Session, card: Card) -> str:
    deck = db.query(Deck).filter(Deck.id == card.deck_id).first()
    return deck.language if deck else ""


def _build_question(db: Session, session: QuizSession, card: Card, user_id: int) -> dict:
    stats = db.query(CardStat).filter(
        CardStat.user_id == user_id, CardStat.card_id == card.id
    ).all()
    direction = pick_direction(session.direction, card, stats or None)
    language = _card_language(db, card)

    if session.mode == "mcq":
        pool = get_distractor_pool(db, language, card.id)
        distractors = random.sample(pool, min(3, len(pool)))
        q = build_mcq_question(card, distractors, direction)

    elif session.mode == "flashcard":
        q = build_typing_question(card, direction)
        q["type"] = "flashcard"
        # Show just the prompt word — no "Type the meaning of:" prefix
        if direction in ("word_to_meaning",):
            q["question"] = card.word
        elif direction == "meaning_to_word":
            q["question"] = card.meaning
        else:
            q["question"] = card.native or card.word

    elif session.mode == "cloze":
        sentence = card.sentence or ""
        q = {
            "type": "cloze",
            "card_id": card.id,
            "question": re.sub(r'\{\{.+?\}\}', '___', sentence),
            "correct_answer": card.word,
            "native": card.native,
        }

    else:
        q = build_typing_question(card, direction)

    q["resolved_direction"] = direction
    q["language"] = language
    # speak_text is always the foreign-language text — never the English prompt
    if direction in ("word_to_meaning", "meaning_to_word"):
        q["speak_text"] = card.word
    else:
        q["speak_text"] = card.native or card.word
    # Include sentence for all modes so the frontend can show it on reveal/feedback.
    # For cloze the sentence is already the question, so skip it to avoid duplication.
    if session.mode != "cloze":
        q["sentence"] = card.sentence
    return q


def _evaluate(
    card: Card,
    direction: str,
    mode: str,
    user_answer: str | None,
    correct_answer_client: str | None,
) -> tuple[bool, str]:
    if direction in ("word_to_meaning", "native_to_meaning"):
        server_correct = card.meaning
    else:
        server_correct = card.word

    if mode == "flashcard":
        is_correct = (user_answer or "").lower().strip() in ("hard", "good", "easy")
        return is_correct, server_correct

    if mode == "cloze":
        server_correct = card.word
        is_correct = check_answer(user_answer or "", server_correct)
        return is_correct, server_correct

    is_correct = check_answer(user_answer or "", server_correct)
    return is_correct, server_correct


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/start", status_code=status.HTTP_201_CREATED)
def start_quiz(
    body: QuizStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if body.scope not in _VALID_SCOPES:
        raise HTTPException(status_code=400, detail=f"scope must be one of {sorted(_VALID_SCOPES)}")
    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {sorted(_VALID_MODES)}")

    if body.scope == "review":
        if not body.deck_id:
            raise HTTPException(status_code=400, detail="deck_id is required for review scope")
        direction = "all_available"
        mode      = "flashcard"
        cards     = select_due_cards(db, body.deck_id, body.card_count, user_id=current_user.id)
        if not cards:
            raise HTTPException(status_code=400, detail="No cards due for review in this deck.")
    else:
        direction = "1_and_2" if body.scope == "big_test" else body.direction
        mode      = body.mode
        if direction not in _VALID_DIRECTIONS:
            raise HTTPException(status_code=400, detail=f"direction must be one of {sorted(_VALID_DIRECTIONS)}")
        if body.scope == "test":
            if not body.deck_id:
                raise HTTPException(status_code=400, detail="deck_id is required for test scope")
            deck = db.query(Deck).filter(Deck.id == body.deck_id).first()
            if not deck:
                raise HTTPException(status_code=404, detail="Deck not found")
            if body.card_ids:
                cards = db.query(Card).filter(
                    Card.id.in_(body.card_ids), Card.is_active.is_(True)
                ).all()
                random.shuffle(cards)
            else:
                cards = select_cards_for_test(db, body.deck_id, body.card_count)
        else:
            cards = select_cards_for_big_test(db, body.card_count, languages=body.languages or None, user_id=current_user.id)

        if mode == "cloze":
            cards = [c for c in cards if c.sentence]
            if not cards:
                raise HTTPException(status_code=400, detail="No cards with example sentences in this deck. Run the sentence generation script first.")

        if not cards:
            raise HTTPException(status_code=400, detail="No active cards available for this session")

    lang_filter = (
        json.dumps(body.languages)
        if body.scope == "big_test" and body.languages
        else None
    )
    session = QuizSession(
        user_id=current_user.id,
        mode=mode,
        scope=body.scope,
        deck_id=body.deck_id,
        direction=direction,
        total=len(cards),
        correct=0,
        language_filter=lang_filter,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    first_card = cards[0]
    question = _build_question(db, session, first_card, current_user.id)

    return {
        "session_id": session.id,
        "scope": session.scope,
        "mode": session.mode,
        "direction": session.direction,
        "total": session.total,
        "question": question,
    }


@router.post("/{session_id}/answer")
def submit_answer(
    session_id: int,
    body: QuizAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    session = db.query(QuizSession).filter(
        QuizSession.id == session_id, QuizSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.finished_at:
        raise HTTPException(status_code=400, detail="Session already completed")

    card = db.query(Card).filter(Card.id == body.card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    is_correct, correct_answer_str = _evaluate(
        card, body.direction, session.mode, body.user_answer, body.correct_answer
    )

    answer = QuizAnswer(
        user_id=current_user.id,
        session_id=session.id,
        card_id=card.id,
        direction=body.direction,
        user_answer=body.user_answer,
        correct_answer=correct_answer_str,
        is_correct=is_correct,
    )
    db.add(answer)

    if is_correct:
        session.correct += 1

    # MCQ answers don't update card stats — recognition ≠ recall mastery
    if session.mode != "mcq":
        grade = body.user_answer if session.mode == "flashcard" else None
        upsert_card_stat(db, current_user.id, card.id, body.direction, is_correct, grade=grade)

    db.flush()

    answered = _answered_ids(db, session.id)
    next_card = _next_card(db, session, answered)

    if next_card is None:
        session.finished_at = datetime.now(timezone.utc)
        db.commit()
        log_study_day(db, current_user.id, cards_seen=session.total)
        return {
            "is_correct": is_correct,
            "correct_answer": correct_answer_str,
            "question": None,
        }

    db.commit()
    next_question = _build_question(db, session, next_card, current_user.id)

    return {
        "is_correct": is_correct,
        "correct_answer": correct_answer_str,
        "question": next_question,
    }


@router.get("/{session_id}/result")
def get_result(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    session = db.query(QuizSession).filter(
        QuizSession.id == session_id, QuizSession.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    answers = db.query(QuizAnswer).filter(QuizAnswer.session_id == session_id).all()

    return {
        "session_id": session.id,
        "scope": session.scope,
        "mode": session.mode,
        "total": session.total,
        "correct": session.correct,
        "finished_at": session.finished_at,
        "answers": [
            {
                "card_id": a.card_id,
                "direction": a.direction,
                "user_answer": a.user_answer,
                "correct_answer": a.correct_answer,
                "is_correct": a.is_correct,
            }
            for a in answers
        ],
    }


@router.post("/hint", response_model=HintResponse)
def get_hint(body: HintRequest) -> HintResponse:
    revealed = set(body.revealed)

    if body.direction == "native_to_word" and not revealed:
        return HintResponse(revealed=[], masked=None, show_full_reading=True)

    if not revealed:
        revealed = first_and_last(body.correct_answer)
    else:
        idx = next_reveal(body.correct_answer, revealed)
        if idx is not None:
            revealed.add(idx)

    masked = generate_letter_mask(body.correct_answer, revealed)
    return HintResponse(revealed=sorted(revealed), masked=masked, show_full_reading=False)
