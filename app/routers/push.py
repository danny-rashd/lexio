from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from pywebpush import WebPushException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.push import PushSubscription
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.push import send_push

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class NotifyRequest(BaseModel):
    title: str
    body: str
    url: str = "/"


@router.get("/vapid-public-key")
def get_vapid_public_key(_: User = Depends(get_current_user)) -> dict:
    if not settings.VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Push notifications are not configured.")
    return {"public_key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=status.HTTP_201_CREATED)
def subscribe(
    body: SubscribeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    existing = db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint
    ).first()
    if existing:
        existing.p256dh = body.p256dh
        existing.auth   = body.auth
    else:
        db.add(PushSubscription(endpoint=body.endpoint, p256dh=body.p256dh, auth=body.auth))
    db.commit()
    return {"status": "subscribed"}


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    body: SubscribeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> None:
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint
    ).delete()
    db.commit()


@router.post("/notify")
def notify(
    body: NotifyRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    if not settings.VAPID_PRIVATE_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Push notifications are not configured.")
    subs = db.query(PushSubscription).all()
    sent = 0
    stale = []
    for sub in subs:
        try:
            send_push(sub, body.title, body.body, body.url)
            sent += 1
        except WebPushException as e:
            if e.response is not None and e.response.status_code == 410:
                stale.append(sub.id)
    for sid in stale:
        db.query(PushSubscription).filter(PushSubscription.id == sid).delete()
    if stale:
        db.commit()
    return {"sent": sent, "removed_stale": len(stale)}
