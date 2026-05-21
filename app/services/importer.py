import csv
import hashlib
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.card import Card, Deck
from app.models.import_log import ImportBatch
from app.utils.text import normalize_deck_label, normalize_text

_ENCODINGS = ("utf-8-sig", "utf-8", "cp1252", "latin-1")


def _detect_encoding(file_path: Path) -> str:
    for enc in _ENCODINGS:
        try:
            file_path.read_text(encoding=enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def compute_idempotency_key(language: str, topic: str, word: str) -> str:
    """
    Deterministic hash for dedup: sha256(language:topic:normalize(word)).

    Args:
        language (str): Deck language identifier (e.g. 'spanish').
        topic (str): Deck topic identifier (e.g. 'greetings').
        word (str): The vocabulary word (raw, not pre-normalized).

    Returns:
        str: Hex digest string (64 chars).

    Notes:
        Word is diacritics-stripped and lowercased before hashing so 'Café'
        and 'cafe' produce the same key. For CJK scripts (Japanese, Mandarin)
        normalize_text() strips all characters to an empty string; in that
        case the raw lowercased word is used directly so each character or
        compound remains a distinct key.
    """
    normalized = normalize_text(word)
    key_word = normalized if normalized.strip() else word.lower().strip()
    raw = f"{language}:{topic}:{key_word}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_vocab_file(file_path: Path) -> list[dict]:
    """
    Parse a CSV or TSV vocabulary file into row dicts.

    Args:
        file_path (Path): Absolute path to the .csv or .tsv file.

    Returns:
        list[dict]: Each dict has keys 'word' (str), 'meaning' (str), and
        'native' (str | None). Header row is excluded. Rows with empty meaning
        are skipped. Comment lines (starting with '#') are skipped.

    Notes:
        - Auto-detects delimiter from file extension (.tsv → tab, else comma).
        - Tries utf-8-sig, utf-8, cp1252, latin-1 in order — accepts files
          exported from Excel or Numbers without manual encoding conversion.
        - Handles rows where the entire line is wrapped in outer quotes
          (e.g. '"hola,hello,"') by re-splitting the single field value.
        - 'native' is None when the column is absent or blank.
    """
    delimiter = "\t" if file_path.suffix.lower() == ".tsv" else ","
    encoding = _detect_encoding(file_path)
    rows: list[dict] = []

    with open(file_path, encoding=encoding, newline="") as f:
        reader = csv.reader(f, delimiter=delimiter)
        next(reader, None)
        for row in reader:
            if not row:
                continue
            if len(row) == 1 and delimiter in row[0]:
                row = next(csv.reader([row[0]]), row)
            if row[0].startswith("#"):
                continue
            word = row[0].strip()
            meaning = row[1].strip() if len(row) > 1 else ""
            native = row[2].strip() if len(row) > 2 else ""
            if not word or not meaning:
                continue
            rows.append({"word": word, "meaning": meaning, "native": native or None})

    return rows


def import_vocab_file(
    db: Session,
    language: str,
    topic: str,
    file_path: Path,
) -> ImportBatch:
    """
    Idempotent ingest of a vocabulary file into the database.

    Args:
        db (Session): SQLAlchemy session.
        language (str): Target language name (normalized internally).
        topic (str): Target topic name (normalized internally).
        file_path (Path): Path to the source file.

    Returns:
        ImportBatch: ORM instance with rows_parsed / rows_inserted / rows_skipped.

    Notes:
        - Normalizes language and topic via normalize_deck_label() before any
          DB operation — caller does not need to pre-normalize.
        - Upserts Deck by (language, topic) unique pair.
        - Fetches all candidate idempotency keys in one query, then bulk-inserts
          only new cards — safe to re-run on the same file.
        - Commits once after all rows are processed.
    """
    language = normalize_deck_label(language)
    topic = normalize_deck_label(topic)

    deck = db.query(Deck).filter(Deck.language == language, Deck.topic == topic).first()
    if not deck:
        deck = Deck(language=language, topic=topic)
        db.add(deck)
        db.flush()

    rows = parse_vocab_file(file_path)
    rows_parsed = len(rows)

    keyed = [(r, compute_idempotency_key(language, topic, r["word"])) for r in rows]
    candidate_keys = [key for _, key in keyed]

    existing_keys = {
        key
        for (key,) in db.query(Card.idempotency_key)
        .filter(Card.idempotency_key.in_(candidate_keys))
        .all()
    }

    new_cards = [
        Card(
            deck_id=deck.id,
            word=r["word"],
            meaning=r["meaning"],
            native=r["native"],
            idempotency_key=key,
        )
        for r, key in keyed
        if key not in existing_keys
    ]

    db.add_all(new_cards)

    rows_inserted = len(new_cards)
    rows_skipped = rows_parsed - rows_inserted

    batch = ImportBatch(
        deck_id=deck.id,
        source_file=str(file_path),
        rows_parsed=rows_parsed,
        rows_inserted=rows_inserted,
        rows_skipped=rows_skipped,
    )
    db.add(batch)
    db.commit()

    return batch
