from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.immersion import ImmersionLog
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.immersion import ImmersionLogCreate, ImmersionLogResponse

router = APIRouter(prefix="/api/immersion", tags=["immersion"])

_VALID_ACTIVITIES = {"reading", "listening", "watching", "speaking", "writing", "gaming", "other"}


@router.post("", response_model=ImmersionLogResponse, status_code=status.HTTP_201_CREATED)
def create_log(
    body: ImmersionLogCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImmersionLogResponse:
    if body.activity_type.lower() not in _VALID_ACTIVITIES:
        raise HTTPException(status_code=400, detail=f"activity_type must be one of {sorted(_VALID_ACTIVITIES)}")
    if body.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes must be greater than 0")
    if body.rating is not None and not (1 <= body.rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")

    log = ImmersionLog(
        language=body.language.lower().strip(),
        activity_type=body.activity_type.lower(),
        resource=body.resource.strip(),
        duration_minutes=body.duration_minutes,
        notes=body.notes,
        rating=body.rating,
        logged_at=body.logged_at,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("", response_model=list[ImmersionLogResponse])
def list_logs(
    language: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=200),
    page: int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ImmersionLogResponse]:
    query = db.query(ImmersionLog)
    if language:
        query = query.filter(ImmersionLog.language == language.lower().strip())
    offset = (page - 1) * limit
    logs = query.order_by(ImmersionLog.logged_at.desc()).offset(offset).limit(limit).all()

    log_ids = [l.id for l in logs]
    counts: dict[int, int] = {}
    if log_ids:
        rows = (
            db.query(Card.source_log_id, func.count(Card.id))
            .filter(Card.source_log_id.in_(log_ids), Card.is_active.is_(True))
            .group_by(Card.source_log_id)
            .all()
        )
        counts = {log_id: cnt for log_id, cnt in rows}

    result = []
    for log in logs:
        d = ImmersionLogResponse.model_validate(log)
        d.word_count = counts.get(log.id, 0)
        result.append(d)
    return result


@router.get("/{log_id}/words")
def get_log_words(
    log_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[dict]:
    cards = (
        db.query(Card)
        .filter(Card.source_log_id == log_id, Card.is_active.is_(True))
        .order_by(Card.created_at)
        .all()
    )
    return [{"word": c.word, "meaning": c.meaning, "native": c.native} for c in cards]


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_log(
    log_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    log = db.query(ImmersionLog).filter(ImmersionLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Log entry not found")
    db.delete(log)
    db.commit()


@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    today      = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=6)

    all_logs   = db.query(ImmersionLog).all()
    week_logs  = db.query(ImmersionLog).filter(
        func.date(ImmersionLog.logged_at) >= week_start
    ).all()

    total_minutes = sum(l.duration_minutes for l in all_logs)
    week_minutes  = sum(l.duration_minutes for l in week_logs)

    by_language: dict[str, int] = {}
    by_activity: dict[str, int] = {}
    for l in all_logs:
        by_language[l.language]      = by_language.get(l.language, 0) + l.duration_minutes
        by_activity[l.activity_type] = by_activity.get(l.activity_type, 0) + l.duration_minutes

    return {
        "total_minutes": total_minutes,
        "week_minutes":  week_minutes,
        "by_language":   by_language,
        "by_activity":   by_activity,
        "total_entries": len(all_logs),
    }
