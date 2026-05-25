from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.config import settings
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.translate import SUPPORTED_CODES, translate_text

router = APIRouter(prefix="/api/translate", tags=["translate"])


class TranslateRequest(BaseModel):
    text: str
    source: str
    target: str

    @field_validator("source", "target")
    @classmethod
    def validate_lang(cls, v: str) -> str:
        if v not in SUPPORTED_CODES:
            raise ValueError(f"Unsupported language code: {v}")
        return v


@router.post("")
def translate(
    body: TranslateRequest,
    _: User = Depends(get_current_user),
) -> dict:
    if not settings.GOOGLE_TTS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Translation is not configured.",
        )
    if body.source == body.target:
        return {"translation": body.text}
    if not body.text.strip():
        return {"translation": ""}
    try:
        result = translate_text(body.text, body.source, body.target, settings.GOOGLE_TTS_API_KEY)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Translation error: {exc}",
        ) from exc
    return {"translation": result}
