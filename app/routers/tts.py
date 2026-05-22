from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response

from app.config import settings
from app.models.user import User
from app.routers.auth import get_current_user
from app.services.tts import synthesize_speech

router = APIRouter(prefix="/api/tts", tags=["tts"])


@router.get("")
def get_tts(
    text: str = Query(..., max_length=200),
    language: str = Query(...),
    _: User = Depends(get_current_user),
) -> Response:
    if not settings.GOOGLE_TTS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS is not configured.",
        )
    try:
        audio = synthesize_speech(text, language, settings.GOOGLE_TTS_API_KEY)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"TTS service error: {exc}",
        ) from exc
    return Response(content=audio, media_type="audio/mpeg")
