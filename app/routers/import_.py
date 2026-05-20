import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.import_log import ImportBatch
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.card import ImportBatchResponse
from app.services.importer import import_vocab_file

router = APIRouter(prefix="/api/import", tags=["import"])

_ALLOWED_SUFFIXES = {".csv", ".tsv"}


@router.post("", response_model=ImportBatchResponse, status_code=status.HTTP_201_CREATED)
async def import_file(
    language: str = Query(...),
    topic: str = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImportBatchResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .csv and .tsv files are supported",
        )

    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        batch = import_vocab_file(db, language, topic, tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    return batch


@router.get("/batches", response_model=list[ImportBatchResponse])
def list_batches(
    deck_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ImportBatchResponse]:
    return db.query(ImportBatch).filter(ImportBatch.deck_id == deck_id).all()
