from datetime import date, datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey,
    Index, Integer, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

_DIRECTIONS = "('word_to_meaning','meaning_to_word','native_to_meaning','native_to_word')"


class CardStat(Base):
    __tablename__ = "card_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False)
    times_seen: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    times_correct: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # SRS scheduling fields (SM-2)
    srs_interval: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    srs_ease_factor: Mapped[float] = mapped_column(Float, default=2.5, nullable=False)
    srs_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    srs_repetitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        CheckConstraint(f"direction IN {_DIRECTIONS}", name="ck_card_stats_direction"),
        UniqueConstraint("card_id", "direction", name="uq_card_stats_card_direction"),
        Index("idx_card_stats_card", "card_id"),
        Index("idx_card_stats_due", "srs_due_date"),
    )


class QuizSession(Base):
    __tablename__ = "quiz_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    mode: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    deck_id: Mapped[int | None] = mapped_column(ForeignKey("decks.id"), nullable=True)
    direction: Mapped[str] = mapped_column(String, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    correct: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    answers: Mapped[list["QuizAnswer"]] = relationship("QuizAnswer", back_populates="session")

    __table_args__ = (
        CheckConstraint("mode IN ('mcq','true_false','typing','flashcard')", name="ck_quiz_sessions_mode"),
        CheckConstraint("scope IN ('test','big_test','review')", name="ck_quiz_sessions_scope"),
        CheckConstraint(
            "direction IN ('1_only','2_only','3_only','4_only','1_and_2','all_available','random')",
            name="ck_quiz_sessions_direction",
        ),
    )


class QuizAnswer(Base):
    __tablename__ = "quiz_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("quiz_sessions.id"), nullable=False)
    card_id: Mapped[int] = mapped_column(ForeignKey("cards.id"), nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False)
    user_answer: Mapped[str | None] = mapped_column(String, nullable=True)
    correct_answer: Mapped[str] = mapped_column(String, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    answered_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    session: Mapped["QuizSession"] = relationship("QuizSession", back_populates="answers")

    __table_args__ = (
        CheckConstraint(f"direction IN {_DIRECTIONS}", name="ck_quiz_answers_direction"),
    )


class StudyLog(Base):
    __tablename__ = "study_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    study_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    sessions: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    cards_seen: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
