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
from app.services.anki_parser import import_anki_deck, parse_anki_preview
from app.services.importer import import_vocab_file

router = APIRouter(prefix="/api/import", tags=["import"])

_ALLOWED_SUFFIXES = {".csv", ".tsv", ".lex"}


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

    tmp_suffix = ".csv" if suffix == ".lex" else suffix  # .lex is CSV under the hood
    with tempfile.NamedTemporaryFile(suffix=tmp_suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        batch = import_vocab_file(db, language, topic, tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    return batch


@router.post("/anki/preview")
async def anki_preview(
    file: UploadFile = File(...),
    _: User = Depends(get_current_user),
) -> dict:
    if not (file.filename or "").lower().endswith(".apkg"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Only .apkg Anki deck files are supported here.")
    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_APKG_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413,
                            detail=f"File too large. Maximum size for Anki decks is {settings.MAX_UPLOAD_SIZE_APKG_MB} MB.")
    with tempfile.NamedTemporaryFile(suffix=".apkg", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        return parse_anki_preview(tmp_path)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Could not parse Anki file: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/anki/confirm", response_model=ImportBatchResponse,
             status_code=status.HTTP_201_CREATED)
async def anki_confirm(
    language: str = Query(...),
    topic: str = Query(...),
    note_type_id: int = Query(...),
    field_word: int = Query(...),
    field_meaning: int = Query(...),
    field_native: int | None = Query(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ImportBatchResponse:
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".apkg", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        batch = import_anki_deck(
            db, tmp_path, language, topic,
            note_type_id, field_word, field_meaning, field_native,
            source_filename=file.filename or "anki_import.apkg",
        )
        return batch
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Import failed: {exc}") from exc
    finally:
        tmp_path.unlink(missing_ok=True)


@router.get("/batches", response_model=list[ImportBatchResponse])
def list_batches(
    deck_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ImportBatchResponse]:
    return db.query(ImportBatch).filter(ImportBatch.deck_id == deck_id).all()
