from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

_ACTIVITY_TYPES = "('reading','listening','watching','speaking','writing','gaming','other')"


class ImmersionLog(Base):
    __tablename__ = "immersion_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    language: Mapped[str] = mapped_column(String, nullable=False)
    activity_type: Mapped[str] = mapped_column(String, nullable=False)
    resource: Mapped[str] = mapped_column(String, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint(f"activity_type IN {_ACTIVITY_TYPES}", name="ck_immersion_activity_type"),
        CheckConstraint("rating IS NULL OR (rating >= 1 AND rating <= 5)", name="ck_immersion_rating"),
        CheckConstraint("duration_minutes > 0", name="ck_immersion_duration"),
    )
