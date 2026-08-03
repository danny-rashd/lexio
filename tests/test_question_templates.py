import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.card import Card, Deck
from app.services.importer import compute_idempotency_key
from app.services.question_templates import (
    ensure_question_templates,
    generate_question_templates,
    read_template_comments,
    write_template_comments,
)


def _write(content: str) -> Path:
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.write(content)
    tmp.close()
    return Path(tmp.name)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    engine.dispose()


class _FakeContent:
    def __init__(self, text):
        self.text = text


class _FakeResponse:
    def __init__(self, text):
        self.content = [_FakeContent(text)]


class _FakeMessages:
    def __init__(self, text):
        self._text = text

    def create(self, **kwargs):
        return _FakeResponse(self._text)


class _FakeClient:
    def __init__(self, text, api_key=None):
        self.messages = _FakeMessages(text)


# ── generate_question_templates ─────────────────────────────────────────────

def test_returns_none_without_api_key(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "")
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result is None


def test_returns_none_with_no_samples(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    result = generate_question_templates("germany", "subdivisions", [])
    assert result is None


def test_returns_templates_on_valid_response(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    text = '{"forward": "What is the capital of {term}?", "reverse": "Which state has {definition} as its capital?"}'
    monkeypatch.setattr(
        "app.services.question_templates.anthropic.Anthropic",
        lambda api_key=None: _FakeClient(text),
    )
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result == (
        "What is the capital of {term}?",
        "Which state has {definition} as its capital?",
    )


def test_returns_none_when_forward_missing_placeholder(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    text = '{"forward": "What is the capital?", "reverse": "Which state has {definition} as its capital?"}'
    monkeypatch.setattr(
        "app.services.question_templates.anthropic.Anthropic",
        lambda api_key=None: _FakeClient(text),
    )
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result is None


def test_returns_none_when_reverse_missing_placeholder(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    text = '{"forward": "What is the capital of {term}?", "reverse": "Which state is this the capital of?"}'
    monkeypatch.setattr(
        "app.services.question_templates.anthropic.Anthropic",
        lambda api_key=None: _FakeClient(text),
    )
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result is None


def test_returns_none_on_malformed_json(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    monkeypatch.setattr(
        "app.services.question_templates.anthropic.Anthropic",
        lambda api_key=None: _FakeClient("not json at all"),
    )
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result is None


def test_extracts_json_from_markdown_fence(monkeypatch):
    monkeypatch.setattr("app.services.question_templates.settings.ANTHROPIC_API_KEY", "fake-key")
    text = '```json\n{"forward": "What is {term}?", "reverse": "What term means {definition}?"}\n```'
    monkeypatch.setattr(
        "app.services.question_templates.anthropic.Anthropic",
        lambda api_key=None: _FakeClient(text),
    )
    result = generate_question_templates("germany", "subdivisions", [("Hesse", "Wiesbaden")])
    assert result == ("What is {term}?", "What term means {definition}?")


# ── ensure_question_templates ────────────────────────────────────────────────

def _make_general_deck(db, subject="germany", topic="subdivisions") -> Deck:
    deck = Deck(category="general", subject=subject, topic=topic)
    db.add(deck)
    db.flush()
    return deck


def _make_card(db, deck: Deck, term: str, definition: str) -> Card:
    card = Card(
        deck_id=deck.id,
        term=term,
        definition=definition,
        idempotency_key=compute_idempotency_key(deck.category, deck.subject, deck.topic, term),
    )
    db.add(card)
    db.flush()
    return card


def test_ensure_skips_language_category_decks(db_session, monkeypatch):
    deck = Deck(category="language", subject="spanish", topic="basics")
    db_session.add(deck)
    db_session.flush()
    called = []
    monkeypatch.setattr(
        "app.services.question_templates.generate_question_templates",
        lambda *a, **k: called.append(1) or ("fwd {term}", "rev {definition}"),
    )
    ensure_question_templates(db_session, deck)
    assert called == []
    assert deck.question_template_forward is None


def test_ensure_skips_deck_that_already_has_template(db_session, monkeypatch):
    deck = _make_general_deck(db_session)
    deck.question_template_forward = "existing {term}"
    _make_card(db_session, deck, "Hesse", "Wiesbaden")
    called = []
    monkeypatch.setattr(
        "app.services.question_templates.generate_question_templates",
        lambda *a, **k: called.append(1) or ("fwd {term}", "rev {definition}"),
    )
    ensure_question_templates(db_session, deck)
    assert called == []
    assert deck.question_template_forward == "existing {term}"


def test_ensure_generates_and_saves_templates_for_new_general_deck(db_session, monkeypatch):
    deck = _make_general_deck(db_session)
    _make_card(db_session, deck, "Hesse", "Wiesbaden")
    _make_card(db_session, deck, "Bavaria", "Munich")
    monkeypatch.setattr(
        "app.services.question_templates.generate_question_templates",
        lambda subject, topic, samples: ("What is the capital of {term}?", "Which state has {definition}?"),
    )
    ensure_question_templates(db_session, deck)
    assert deck.question_template_forward == "What is the capital of {term}?"
    assert deck.question_template_reverse == "Which state has {definition}?"


def test_ensure_leaves_templates_none_when_generation_fails(db_session, monkeypatch):
    deck = _make_general_deck(db_session)
    _make_card(db_session, deck, "Hesse", "Wiesbaden")
    monkeypatch.setattr(
        "app.services.question_templates.generate_question_templates",
        lambda *a, **k: None,
    )
    ensure_question_templates(db_session, deck)
    assert deck.question_template_forward is None
    assert deck.question_template_reverse is None


# ── read_template_comments / write_template_comments ────────────────────────

def test_read_template_comments_returns_none_when_absent():
    path = _write("term,definition\nHesse,Wiesbaden\n")
    assert read_template_comments(path) is None


def test_read_template_comments_returns_none_when_only_forward_present():
    path = _write(
        "# question_template_forward: What is the capital of {term}?\n"
        "term,definition\nHesse,Wiesbaden\n"
    )
    assert read_template_comments(path) is None


def test_read_template_comments_parses_both_lines():
    path = _write(
        "# question_template_forward: What is the capital of {term}?\n"
        "# question_template_reverse: Which state has {definition}?\n"
        "term,definition\nHesse,Wiesbaden\n"
    )
    result = read_template_comments(path)
    assert result == (
        "What is the capital of {term}?",
        "Which state has {definition}?",
    )


def test_read_template_comments_stops_at_first_non_comment_line():
    # A '#'-looking value inside the data section must not be picked up.
    path = _write(
        "term,definition\n"
        "# question_template_forward: should not be read,ignored\n"
    )
    assert read_template_comments(path) is None


def test_write_template_comments_prepends_lines(tmp_path):
    path = tmp_path / "states.csv"
    path.write_text("term,definition\nHesse,Wiesbaden\n", encoding="utf-8")
    write_template_comments(path, "What is the capital of {term}?", "Which state has {definition}?")
    content = path.read_text(encoding="utf-8")
    assert content.splitlines()[0] == "# question_template_forward: What is the capital of {term}?"
    assert content.splitlines()[1] == "# question_template_reverse: Which state has {definition}?"
    assert content.splitlines()[2] == "term,definition"
    assert content.splitlines()[3] == "Hesse,Wiesbaden"


def test_write_then_read_round_trips(tmp_path):
    path = tmp_path / "states.csv"
    path.write_text("term,definition\nHesse,Wiesbaden\n", encoding="utf-8")
    write_template_comments(path, "What is the capital of {term}?", "Which state has {definition}?")
    assert read_template_comments(path) == (
        "What is the capital of {term}?",
        "Which state has {definition}?",
    )


def test_write_then_parse_vocab_file_does_not_produce_bogus_row():
    from app.services.importer import parse_vocab_file

    path = _write("term,definition\nHesse,Wiesbaden\n")
    write_template_comments(path, "What is the capital of {term}?", "Which state has {definition}?")
    rows = parse_vocab_file(path)
    assert rows == [
        {"term": "Hesse", "definition": "Wiesbaden", "native": None, "sentence": None, "ipa": None, "notes": None},
    ]
