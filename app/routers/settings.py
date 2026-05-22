from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.progress import QuizAnswer
from app.models.settings import UserSetting
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["settings"])

_DEFAULT_DAILY_GOAL = 20


class DailyGoalRequest(BaseModel):
    goal: int = Field(..., ge=1, le=500)


@router.get("/daily-goal")
def get_daily_goal(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """
    Return the user's daily card goal and how many cards they have answered today.

    Args:
        db (Session): Database session.
        _ (User): Authenticated user (unused beyond auth check).

    Returns:
        dict: Keys 'goal' (int) and 'today_count' (int).

    Notes:
        today_count counts all QuizAnswer rows whose answered_at falls on today's date.
        Falls back to goal=20 if no setting has been saved yet.
    """
    setting = db.query(UserSetting).filter(UserSetting.key == "daily_goal").first()
    goal = int(setting.value) if setting else _DEFAULT_DAILY_GOAL

    today_start = datetime.combine(date.today(), datetime.min.time())
    today_count: int = (
        db.query(func.count(QuizAnswer.id))
        .filter(QuizAnswer.answered_at >= today_start)
        .scalar()
        or 0
    )

    return {"goal": goal, "today_count": today_count}


@router.put("/daily-goal")
def set_daily_goal(
    body: DailyGoalRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """
    Persist the user's daily card goal.

    Args:
        body (DailyGoalRequest): Request body containing 'goal' (1–500).
        db (Session): Database session.
        _ (User): Authenticated user (unused beyond auth check).

    Returns:
        dict: Saved 'goal' value.
    """
    setting = db.query(UserSetting).filter(UserSetting.key == "daily_goal").first()
    if setting:
        setting.value = str(body.goal)
    else:
        db.add(UserSetting(key="daily_goal", value=str(body.goal)))
    db.commit()
    return {"goal": body.goal}
