import json
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.import_log import ImportBatch
from app.services.importer import import_rows


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text).replace("&nbsp;", " ").strip()


def _open_anki_db(apkg_path: Path, tmpdir: Path) -> sqlite3.Connection:
    with zipfile.ZipFile(apkg_path, "r") as zf:
        names = zf.namelist()
        db_name = "collection.anki21" if "collection.anki21" in names else "collection.anki2"
        zf.extract(db_name, tmpdir)
    conn = sqlite3.connect(str(tmpdir / db_name))
    conn.row_factory = sqlite3.Row
    return conn


def _note_types_new(conn: sqlite3.Connection) -> list[dict] | None:
    """Read note types from Anki 2.1.28+ schema (separate notetypes + fields tables)."""
    try:
        rows = conn.execute("SELECT id, name FROM notetypes").fetchall()
        result = []
        for row in rows:
            flds = conn.execute(
                "SELECT name FROM fields WHERE ntid = ? ORDER BY ord", (row["id"],)
            ).fetchall()
            result.append({"id": row["id"], "name": row["name"], "fields": [f["name"] for f in flds]})
        return result or None
    except sqlite3.OperationalError:
        return None


def _note_types_legacy(conn: sqlite3.Connection) -> list[dict]:
    """Read note types from legacy Anki schema (models JSON in col table)."""
    col = conn.execute("SELECT models FROM col").fetchone()
    models = json.loads(col["models"])
    result = []
    for mid, model in models.items():
        fields = [f["name"] for f in sorted(model.get("flds", []), key=lambda x: x.get("ord", 0))]
        result.append({"id": int(mid), "name": model.get("name", str(mid)), "fields": fields})
    return result


def parse_anki_preview(apkg_path: Path) -> dict:
    """
    Parse an Anki .apkg file and return note type metadata plus sample rows.

    Args:
        apkg_path (Path): Path to the .apkg file.

    Returns:
        dict with key 'note_types': list of {id, name, fields, sample_rows}.
        sample_rows contains up to 5 rows as lists of field strings (HTML stripped).

    Notes:
        Handles both Anki 2.1.28+ (separate notetypes table) and older
        (models JSON in col table). Uses stdlib zipfile + sqlite3 only.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        conn = _open_anki_db(apkg_path, Path(tmpdir))
        try:
            note_types = _note_types_new(conn) or _note_types_legacy(conn)
            for nt in note_types:
                rows = conn.execute(
                    "SELECT flds FROM notes WHERE mid = ? LIMIT 5", (nt["id"],)
                ).fetchall()
                nt["sample_rows"] = [
                    [_strip_html(f) for f in row["flds"].split("\x1f")]
                    for row in rows
                ]
            return {"note_types": note_types}
        finally:
            conn.close()


def import_anki_deck(
    db: Session,
    apkg_path: Path,
    category: str,
    subject: str,
    topic: str,
    note_type_id: int,
    field_term: int,
    field_definition: int,
    field_native: int | None,
    source_filename: str,
) -> ImportBatch:
    """
    Import cards from an Anki .apkg file using a caller-supplied field mapping.

    Args:
        db (Session): SQLAlchemy session.
        apkg_path (Path): Path to the .apkg file.
        category (str): 'language' or 'general'.
        subject (str): Target subject (normalized internally).
        topic (str): Target topic (normalized internally).
        note_type_id (int): The Anki note type (model) ID to import.
        field_term (int): Zero-based index of the field to use as 'term'.
        field_definition (int): Zero-based index of the field to use as 'definition'.
        field_native (int | None): Zero-based index of the field to use as 'native', or None.
        source_filename (str): Display name stored on the ImportBatch record.

    Returns:
        ImportBatch: ORM instance with rows_parsed / rows_inserted / rows_skipped.

    Notes:
        HTML tags and &nbsp; are stripped from all field values.
        Rows where term or definition is empty after stripping are skipped.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        conn = _open_anki_db(apkg_path, Path(tmpdir))
        try:
            raw_rows = conn.execute(
                "SELECT flds FROM notes WHERE mid = ?", (note_type_id,)
            ).fetchall()
        finally:
            conn.close()

    rows: list[dict] = []
    for raw in raw_rows:
        parts = raw["flds"].split("\x1f")
        term       = _strip_html(parts[field_term])       if field_term       < len(parts) else ""
        definition = _strip_html(parts[field_definition])  if field_definition < len(parts) else ""
        native     = _strip_html(parts[field_native])       if field_native is not None and field_native < len(parts) else None
        if term and definition:
            rows.append({"term": term, "definition": definition, "native": native or None})

    return import_rows(db, category, subject, topic, rows, source_filename)
