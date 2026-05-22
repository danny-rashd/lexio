import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.essay import EssaySubmission
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.essay import EssayHistoryItem, EssaySubmitRequest
from app.services.essay_evaluator import check_language, evaluate_essay

router = APIRouter(prefix="/api/essay", tags=["essay"])


@router.post("/submit", status_code=status.HTTP_201_CREATED)
def submit_essay(
    body: EssaySubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Essay evaluation is not configured. Add ANTHROPIC_API_KEY to your environment.",
        )

    words = body.text.strip().split()
    if len(words) < settings.ESSAY_MIN_WORDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Essay must be at least {settings.ESSAY_MIN_WORDS} words.",
        )
    if len(words) > settings.ESSAY_MAX_WORDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Essay must be {settings.ESSAY_MAX_WORDS} words or fewer.",
        )

    lang_check = check_language(body.text, body.language)
    warning = None
    if not lang_check["match"]:
        if lang_check["confidence"] >= 0.95:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code":     "language_mismatch",
                    "detected": lang_check["detected"],
                    "selected": body.language.capitalize(),
                },
            )
        elif lang_check["confidence"] >= 0.60:
            warning = {
                "code":     "language_uncertain",
                "detected": lang_check["detected"],
                "selected": body.language.capitalize(),
            }

    try:
        evaluation = evaluate_essay(body.text, body.language)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Evaluation service returned an unexpected response: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Evaluation failed: {exc}",
        ) from exc

    submission = EssaySubmission(
        user_id=current_user.id,
        language=body.language,
        text=body.text,
        word_count=len(words),
        overall_score=float(evaluation.get("overall_score", 0)),
        evaluation=json.dumps(evaluation),
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    return {
        "id":         submission.id,
        "word_count": len(words),
        "evaluation": evaluation,
        "warning":    warning,
    }


@router.get("/history", response_model=list[EssayHistoryItem])
def get_history(
    limit: int = Query(default=20, ge=1, le=100),
    language: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[EssayHistoryItem]:
    query = db.query(EssaySubmission).filter(EssaySubmission.user_id == current_user.id)
    if language:
        query = query.filter(EssaySubmission.language == language.lower().strip())
    return query.order_by(EssaySubmission.submitted_at.desc()).limit(limit).all()


@router.get("/{essay_id}")
def get_essay(
    essay_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    sub = db.query(EssaySubmission).filter(
        EssaySubmission.id == essay_id, EssaySubmission.user_id == current_user.id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Essay not found")
    return {
        "id": sub.id,
        "language": sub.language,
        "text": sub.text,
        "word_count": sub.word_count,
        "overall_score": sub.overall_score,
        "evaluation": json.loads(sub.evaluation),
        "submitted_at": sub.submitted_at,
    }


@router.get("/stats")
def get_essay_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    subs = db.query(EssaySubmission).filter(
        EssaySubmission.user_id == current_user.id
    ).order_by(EssaySubmission.submitted_at.desc()).all()
    if not subs:
        return {"total": 0, "average_score": 0.0, "best_score": 0.0, "by_language": {}, "recent": []}

    total      = len(subs)
    avg_score  = round(sum(s.overall_score for s in subs) / total, 1)
    best_score = round(max(s.overall_score for s in subs), 1)

    lang_agg: dict[str, dict] = {}
    for s in subs:
        if s.language not in lang_agg:
            lang_agg[s.language] = {"count": 0, "total": 0.0}
        lang_agg[s.language]["count"]  += 1
        lang_agg[s.language]["total"]  += s.overall_score

    by_language = {
        lang: {"count": v["count"], "avg_score": round(v["total"] / v["count"], 1)}
        for lang, v in lang_agg.items()
    }

    recent = [
        {"id": s.id, "language": s.language, "overall_score": s.overall_score,
         "submitted_at": s.submitted_at.isoformat()}
        for s in subs[:5]
    ]

    # Chronological score trend per language for sparklines
    trend_by_language: dict[str, list] = {}
    for s in reversed(subs):
        trend_by_language.setdefault(s.language, []).append({
            "date":  s.submitted_at.strftime("%Y-%m-%d"),
            "score": round(s.overall_score, 1),
        })

    return {"total": total, "average_score": avg_score, "best_score": best_score,
            "by_language": by_language, "recent": recent, "trend_by_language": trend_by_language}
