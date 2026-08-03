from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Index, String,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    subject: Mapped[str] = mapped_column(String, nullable=False)
    topic: Mapped[str] = mapped_column(String, nullable=False)
    question_template_forward: Mapped[str | None] = mapped_column(String, nullable=True)
    question_template_reverse: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    cards: Mapped[list["Card"]] = relationship("Card", back_populates="deck")

    __table_args__ = (
        CheckConstraint("category IN ('language','general')", name="ck_decks_category"),
        UniqueConstraint("category", "subject", "topic", name="uq_decks_category_subject_topic"),
        Index("idx_decks_subject", "subject"),
    )


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(ForeignKey("decks.id"), nullable=False)
    term: Mapped[str] = mapped_column(String, nullable=False)
    definition: Mapped[str] = mapped_column(String, nullable=False)
    native: Mapped[str | None] = mapped_column(String, nullable=True)
    sentence: Mapped[str | None] = mapped_column(String, nullable=True)
    ipa: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("immersion_logs.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    deck: Mapped["Deck"] = relationship("Deck", back_populates="cards")

    __table_args__ = (
        Index("idx_cards_deck", "deck_id"),
        Index("idx_cards_key", "idempotency_key"),
    )
