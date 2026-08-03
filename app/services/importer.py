import csv
import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.card import Card, Deck
from app.models.import_log import ImportBatch
from app.utils.text import normalize_deck_label, normalize_text

_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
_CATEGORIES = ("language", "general")


def _detect_encoding(file_path: Path) -> str:
    for enc in _ENCODINGS:
        try:
            file_path.read_text(encoding=enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def compute_idempotency_key(category: str, subject: str, topic: str, term: str) -> str:
    """
    Deterministic hash for dedup: sha256(category:subject:topic:normalize(term)).

    Args:
        category (str): 'language' or 'general'.
        subject (str): Deck subject identifier (e.g. 'spanish', 'history').
        topic (str): Deck topic identifier (e.g. 'greetings', 'world-war-2').
        term (str): The card term (raw, not pre-normalized).

    Returns:
        str: Hex digest string (64 chars).

    Notes:
        Term is diacritics-stripped and lowercased before hashing so 'Café'
        and 'cafe' produce the same key. For CJK scripts (Japanese, Mandarin)
        normalize_text() strips all characters to an empty string; in that
        case the raw lowercased term is used directly so each character or
        compound remains a distinct key.
    """
    normalized = normalize_text(term)
    key_term = normalized if normalized.strip() else term.lower().strip()
    raw = f"{category}:{subject}:{topic}:{key_term}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_vocab_file(file_path: Path) -> list[dict]:
    """
    Parse a CSV or TSV vocab/topic file into row dicts.

    Args:
        file_path (Path): Absolute path to the .csv or .tsv file.

    Returns:
        list[dict]: Each dict has keys 'term', 'definition', 'native',
        'sentence', 'ipa', 'notes'. Header row is excluded. Rows with empty
        definition are skipped. Comment lines (starting with '#') are skipped.

    Notes:
        - Auto-detects delimiter from file extension (.tsv → tab, else comma).
        - Tries utf-8-sig, utf-8, cp1252, latin-1 in order — accepts files
          exported from Excel or Numbers without manual encoding conversion.
        - Handles rows where the entire line is wrapped in outer quotes
          (e.g. '"hola,hello,"') by re-splitting the single field value.
        - Columns beyond term/definition are optional and None when absent —
          general-topic files typically omit native/sentence/ipa entirely.
        - Comment lines are skipped wherever they appear, including before
          the header row (e.g. '# subject: ...' metadata lines) — the header
          row is whichever line is first to not start with '#', not
          necessarily the file's first line.
    """
    delimiter = "\t" if file_path.suffix.lower() == ".tsv" else ","
    encoding = _detect_encoding(file_path)
    rows: list[dict] = []

    with open(file_path, encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        header_skipped = False
        for row in reader:
            if not row:
                continue
            if len(row) == 1 and delimiter in row[0]:
                row = next(csv.reader([row[0]]), row)
            if row[0].startswith("#"):
                continue
            if not header_skipped:
                header_skipped = True
                continue
            term = row[0].strip()
            definition = row[1].strip() if len(row) > 1 else ""
            native   = row[2].strip() if len(row) > 2 else ""
            sentence = row[3].strip() if len(row) > 3 else ""
            ipa      = row[4].strip() if len(row) > 4 else ""
            notes    = row[5].strip() if len(row) > 5 else ""
            if not term or not definition:
                continue
            rows.append({
                "term": term, "definition": definition, "native": native or None,
                "sentence": sentence or None, "ipa": ipa or None, "notes": notes or None,
            })

    return rows


def import_rows(
    db: Session,
    category: str,
    subject: str,
    topic: str,
    rows: list[dict],
    source_file: str,
) -> ImportBatch:
    """
    Idempotent ingest of pre-parsed rows into the database.

    Args:
        db (Session): SQLAlchemy session.
        category (str): 'language' or 'general'.
        subject (str): Target subject name (normalized internally).
        topic (str): Target topic name (normalized internally).
        rows (list[dict]): Each dict must have 'term' and 'definition' keys.
        source_file (str): Display name stored on the ImportBatch record.

    Returns:
        ImportBatch: ORM instance with rows_parsed / rows_inserted / rows_skipped.

    Notes:
        Called by both import_vocab_file (CSV/TSV) and the Anki import endpoint.
        Normalizes subject and topic; upserts Deck; bulk-inserts new cards.
    """
    if category not in _CATEGORIES:
        raise ValueError(f"category must be one of {_CATEGORIES}, got {category!r}")

    subject = normalize_deck_label(subject)
    topic   = normalize_deck_label(topic)

    deck = db.query(Deck).filter(
        Deck.category == category, Deck.subject == subject, Deck.topic == topic
    ).first()
    if not deck:
        deck = Deck(category=category, subject=subject, topic=topic)
        db.add(deck)
        db.flush()

    rows_parsed = len(rows)

    keyed = [(r, compute_idempotency_key(category, subject, topic, r["term"])) for r in rows]
    candidate_keys = [key for _, key in keyed]

    existing_keys = {
        key
        for (key,) in db.query(Card.idempotency_key)
        .filter(Card.idempotency_key.in_(candidate_keys))
        .all()
    }

    seen_in_batch: set[str] = set()
    new_cards = []
    for r, key in keyed:
        if key not in existing_keys and key not in seen_in_batch:
            seen_in_batch.add(key)
            new_cards.append(Card(
                deck_id=deck.id,
                term=r["term"],
                definition=r["definition"],
                native=r.get("native"),
                sentence=r.get("sentence"),
                ipa=r.get("ipa"),
                notes=r.get("notes"),
                idempotency_key=key,
            ))
        elif key in existing_keys:
            updates: dict = {}
            if r.get("sentence"): updates["sentence"] = r["sentence"]
            if r.get("ipa"):      updates["ipa"]      = r["ipa"]
            if r.get("notes"):    updates["notes"]    = r["notes"]
            if updates:
                for field, value in updates.items():
                    db.query(Card).filter(
                        Card.idempotency_key == key,
                        getattr(Card, field).is_(None),
                    ).update({field: value})

    db.add_all(new_cards)

    rows_inserted = len(new_cards)
    rows_skipped = rows_parsed - rows_inserted

    batch = ImportBatch(
        deck_id=deck.id,
        source_file=source_file,
        rows_parsed=rows_parsed,
        rows_inserted=rows_inserted,
        rows_skipped=rows_skipped,
    )
    db.add(batch)
    db.commit()

    return batch


def import_vocab_file(
    db: Session,
    category: str,
    subject: str,
    topic: str,
    file_path: Path,
) -> ImportBatch:
    """
    Idempotent ingest of a CSV/TSV file into the database.

    Args:
        db (Session): SQLAlchemy session.
        category (str): 'language' or 'general'.
        subject (str): Target subject name (normalized internally).
        topic (str): Target topic name (normalized internally).
        file_path (Path): Path to the source CSV or TSV file.

    Returns:
        ImportBatch: ORM instance with rows_parsed / rows_inserted / rows_skipped.
    """
    rows = parse_vocab_file(file_path)
    return import_rows(db, category, subject, topic, rows, str(file_path))
