import json
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card, Deck
from app.models.essay import EssaySubmission
from app.models.immersion import ImmersionLog
from app.models.import_log import ImportBatch
from app.models.progress import CardStat, QuizAnswer, QuizSession, StudyLog
from app.models.push import PushSubscription
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
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Return the user's daily card goal and how many cards they have answered today.

    Args:
        db (Session): Database session.
        current_user (User): Authenticated user.

    Returns:
        dict: Keys 'goal' (int) and 'today_count' (int).

    Notes:
        Both goal and today_count are scoped to the current user only.
        Falls back to goal=20 if no setting has been saved yet.
    """
    setting = db.query(UserSetting).filter(
        UserSetting.user_id == current_user.id,
        UserSetting.key == "daily_goal",
    ).first()
    goal = int(setting.value) if setting else _DEFAULT_DAILY_GOAL

    from datetime import timezone
    today_start = datetime.combine(datetime.now(timezone.utc).date(), datetime.min.time())
    today_count: int = (
        db.query(func.count(QuizAnswer.id))
        .join(QuizSession, QuizAnswer.session_id == QuizSession.id)
        .filter(
            QuizAnswer.user_id == current_user.id,
            QuizAnswer.answered_at >= today_start,
            QuizSession.finished_at.isnot(None),
        )
        .scalar()
        or 0
    )

    return {"goal": goal, "today_count": today_count}


@router.put("/daily-goal")
def set_daily_goal(
    body: DailyGoalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Persist the user's daily card goal.

    Args:
        body (DailyGoalRequest): Request body containing 'goal' (1–500).
        db (Session): Database session.
        current_user (User): Authenticated user.

    Returns:
        dict: Saved 'goal' value.
    """
    setting = db.query(UserSetting).filter(
        UserSetting.user_id == current_user.id,
        UserSetting.key == "daily_goal",
    ).first()
    if setting:
        setting.value = str(body.goal)
    else:
        db.add(UserSetting(user_id=current_user.id, key="daily_goal", value=str(body.goal)))
    db.commit()
    return {"goal": body.goal}


class HiddenSubjectRequest(BaseModel):
    subject: str
    hidden: bool


@router.get("/hidden-subjects")
def get_hidden_subjects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    setting = db.query(UserSetting).filter(
        UserSetting.user_id == current_user.id,
        UserSetting.key == "hidden_subjects",
    ).first()
    hidden = json.loads(setting.value) if setting else []
    return {"hidden": hidden}


@router.post("/hidden-subjects")
def toggle_hidden_subject(
    body: HiddenSubjectRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    subject = body.subject.lower().strip()
    setting = db.query(UserSetting).filter(
        UserSetting.user_id == current_user.id,
        UserSetting.key == "hidden_subjects",
    ).first()
    hidden: list[str] = json.loads(setting.value) if setting else []

    if body.hidden and subject not in hidden:
        hidden.append(subject)
    elif not body.hidden and subject in hidden:
        hidden.remove(subject)

    if setting:
        setting.value = json.dumps(hidden)
    else:
        db.add(UserSetting(user_id=current_user.id, key="hidden_subjects", value=json.dumps(hidden)))
    db.commit()
    return {"hidden": hidden}


class ResetRequest(BaseModel):
    type: str = Field(..., pattern="^(soft|hard)$")


@router.post("/reset")
def reset_data(
    body: ResetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Reset app data for the current user only. Soft keeps decks and cards;
    hard deletes all user activity and settings.

    Args:
        body (ResetRequest): type must be 'soft' or 'hard'.
        db (Session): Database session.
        current_user (User): Authenticated user — only their data is deleted.

    Returns:
        dict: Confirmation of reset type performed.
    """
    uid = current_user.id

    db.query(QuizAnswer).filter(QuizAnswer.user_id == uid).delete(synchronize_session=False)
    db.query(QuizSession).filter(QuizSession.user_id == uid).delete(synchronize_session=False)
    db.query(CardStat).filter(CardStat.user_id == uid).delete(synchronize_session=False)
    db.query(StudyLog).filter(StudyLog.user_id == uid).delete(synchronize_session=False)
    db.query(EssaySubmission).filter(EssaySubmission.user_id == uid).delete(synchronize_session=False)
    db.query(ImmersionLog).filter(ImmersionLog.user_id == uid).delete(synchronize_session=False)

    if body.type == "hard":
        db.query(PushSubscription).delete(synchronize_session=False)
        db.query(UserSetting).filter(UserSetting.user_id == uid).delete(synchronize_session=False)

    db.commit()
    return {"reset": body.type}
