import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.services.importer import compute_idempotency_key, import_vocab_file, parse_vocab_file
from app.utils.text import normalize_deck_label, normalize_text


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


def _write(content: str, suffix: str = ".csv") -> Path:
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8")
    tmp.write(content)
    tmp.close()
    return Path(tmp.name)


# ── normalize_text ────────────────────────────────────────────────────────────

def test_normalize_text_strips_latin_diacritics():
    assert normalize_text("café") == "cafe"
    assert normalize_text("å") == "a"


def test_normalize_text_strips_pinyin_tones():
    assert normalize_text("nǐ hǎo") == "ni hao"


# ── normalize_deck_label ──────────────────────────────────────────────────────

def test_normalize_deck_label_lowercases_and_strips():
    assert normalize_deck_label("Spanish") == "spanish"
    assert normalize_deck_label("  Spanish  ") == "spanish"
    assert normalize_deck_label("GREETINGS") == "greetings"


def test_normalize_deck_label_resolves_to_same_deck(db_session):
    path = _write("term,definition,native\nhola,hello,\n")
    b1 = import_vocab_file(db_session, "language", "Spanish", "Greetings", path)
    b2 = import_vocab_file(db_session, "language", "spanish", "greetings", path)
    assert b1.deck_id == b2.deck_id


# ── compute_idempotency_key ───────────────────────────────────────────────────

def test_idempotency_key_deterministic_and_case_insensitive():
    k1 = compute_idempotency_key("language", "spanish", "basics", "Café")
    k2 = compute_idempotency_key("language", "spanish", "basics", "café")
    k3 = compute_idempotency_key("language", "spanish", "basics", "cafe")
    assert k1 == k2 == k3
    assert len(k1) == 64


# ── parse_vocab_file ──────────────────────────────────────────────────────────

def test_parse_valid_csv_with_native():
    path = _write("term,definition,native\nkonnichiwa,hello,こんにちは\narigatou,thank you,ありがとう\n")
    rows = parse_vocab_file(path)
    assert rows == [
        {"term": "konnichiwa", "definition": "hello", "native": "こんにちは", "sentence": None, "ipa": None, "notes": None},
        {"term": "arigatou", "definition": "thank you", "native": "ありがとう", "sentence": None, "ipa": None, "notes": None},
    ]


def test_parse_valid_csv_empty_native_stored_as_none():
    path = _write("term,definition,native\nhola,hello,\ngracias,thank you,\n")
    rows = parse_vocab_file(path)
    assert all(r["native"] is None for r in rows)


def test_parse_valid_tsv():
    path = _write("term\tdefinition\tnative\nhola\thello\t\ngracias\tthank you\t\n", suffix=".tsv")
    rows = parse_vocab_file(path)
    assert len(rows) == 2
    assert rows[0]["term"] == "hola"
    assert rows[0]["native"] is None


def test_parse_skips_empty_definition():
    path = _write("term,definition,native\nhola,hello,\nperro,,\n")
    rows = parse_vocab_file(path)
    assert len(rows) == 1
    assert rows[0]["term"] == "hola"


def test_parse_skips_comment_lines():
    path = _write("term,definition,native\n# this is a comment\nhola,hello,\n")
    rows = parse_vocab_file(path)
    assert len(rows) == 1
    assert rows[0]["term"] == "hola"


def test_parse_general_topic_csv_without_native():
    path = _write("term,definition\nTreaty of Versailles,Ended WWI in 1919\n")
    rows = parse_vocab_file(path)
    assert rows == [
        {"term": "Treaty of Versailles", "definition": "Ended WWI in 1919", "native": None, "sentence": None, "ipa": None, "notes": None},
    ]


def test_parse_skips_comment_lines_before_header():
    # Matches the .lex export format: several '#' metadata lines before the
    # real header row. The header itself must not be treated as a data row.
    path = _write(
        "# Lexio deck export\n"
        "# category: general\n"
        "# subject: germany\n"
        "term,definition\n"
        "Hesse,Wiesbaden\n"
    )
    rows = parse_vocab_file(path)
    assert rows == [
        {"term": "Hesse", "definition": "Wiesbaden", "native": None, "sentence": None, "ipa": None, "notes": None},
    ]


def test_parse_skips_multiple_comment_lines_before_header_tsv():
    path = _write(
        "# question_template_forward: What is the capital of {term}?\n"
        "# question_template_reverse: Which state has {definition}?\n"
        "term\tdefinition\n"
        "Hesse\tWiesbaden\n",
        suffix=".tsv",
    )
    rows = parse_vocab_file(path)
    assert len(rows) == 1
    assert rows[0]["term"] == "Hesse"


# ── import_vocab_file ─────────────────────────────────────────────────────────

def test_reimport_does_not_create_duplicates(db_session):
    path = _write("term,definition,native\nhola,hello,\ngracias,thank you,\n")
    b1 = import_vocab_file(db_session, "language", "spanish", "basics", path)
    b2 = import_vocab_file(db_session, "language", "spanish", "basics", path)
    assert b1.rows_inserted == 2
    assert b2.rows_inserted == 0
    assert b2.rows_skipped == 2


def test_rows_skipped_count_after_partial_reimport(db_session):
    path1 = _write("term,definition,native\nhola,hello,\ngracias,thank you,\n")
    import_vocab_file(db_session, "language", "spanish", "basics", path1)
    path2 = _write("term,definition,native\nhola,hello,\ngracias,thank you,\ncasa,house,\n")
    b2 = import_vocab_file(db_session, "language", "spanish", "basics", path2)
    assert b2.rows_skipped == 2
    assert b2.rows_inserted == 1
    assert b2.rows_parsed == 3


def test_same_term_different_topics_are_distinct_cards(db_session):
    path = _write("term,definition,native\nhola,hello,\n")
    b1 = import_vocab_file(db_session, "language", "spanish", "greetings", path)
    b2 = import_vocab_file(db_session, "language", "spanish", "travel", path)
    assert b1.rows_inserted == 1
    assert b2.rows_inserted == 1
    assert b1.deck_id != b2.deck_id


def test_same_subject_different_category_are_distinct_decks(db_session):
    path = _write("term,definition,native\nhistory,the study of the past,\n")
    b1 = import_vocab_file(db_session, "language", "history", "basics", path)
    b2 = import_vocab_file(db_session, "general", "history", "basics", path)
    assert b1.deck_id != b2.deck_id


# ── 413 size guard (via router) ───────────────────────────────────────────────

def _over_limit_content() -> bytes:
    # 5 MB + 1 byte — guaranteed to exceed MAX_UPLOAD_SIZE_MB=5
    return b"term,definition,native\n" + b"a,b,\n" * (5 * 1024 * 1024 // 5 + 1)


def test_import_returns_413_when_file_too_large(client, seeded_user):
    token = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "testpass"},
    ).json()["access_token"]

    res = client.post(
        "/api/import?category=language&subject=spanish&topic=basics",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.csv", _over_limit_content(), "text/csv")},
    )
    assert res.status_code == 413


def test_import_413_response_contains_readable_message(client, seeded_user):
    token = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "testpass"},
    ).json()["access_token"]

    res = client.post(
        "/api/import?category=language&subject=spanish&topic=basics",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("test.csv", _over_limit_content(), "text/csv")},
    )
    assert "Maximum size" in res.json()["detail"]
