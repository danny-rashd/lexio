import json
import re
from pathlib import Path

import anthropic
from sqlalchemy.orm import Session

from app.config import settings
from app.models.card import Card, Deck

_MODEL = "claude-haiku-4-5-20251001"

_FORWARD_COMMENT_RE = re.compile(r'^#\s*question_template_forward:\s*(.+)$', re.IGNORECASE)
_REVERSE_COMMENT_RE = re.compile(r'^#\s*question_template_reverse:\s*(.+)$', re.IGNORECASE)


def read_template_comments(file_path: Path) -> tuple[str, str] | None:
    """
    Read question templates previously cached as leading comment lines in a
    deck's source CSV/TSV file.

    Args:
        file_path (Path): Path to the CSV or TSV file.

    Returns:
        tuple[str, str] | None: (forward_template, reverse_template) if both
        are present in the file's leading '#' comment lines, else None.

    Notes:
        Only scans leading comment lines (stops at the first line that
        doesn't start with '#'), matching the '# key: value' convention
        already used by the .lex deck export format.
    """
    forward = reverse = None
    for line in file_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.startswith("#"):
            break
        m = _FORWARD_COMMENT_RE.match(line)
        if m:
            forward = m.group(1).strip()
        m = _REVERSE_COMMENT_RE.match(line)
        if m:
            reverse = m.group(1).strip()
    if forward and reverse:
        return forward, reverse
    return None


def write_template_comments(file_path: Path, forward: str, reverse: str) -> None:
    """
    Cache generated question templates as leading comment lines prepended to
    a deck's source CSV/TSV file, so future imports of the same file reuse
    them instead of calling the AI again.

    Args:
        file_path (Path): Path to the CSV or TSV file. Modified in place.
        forward (str): Forward question template (contains '{term}').
        reverse (str): Reverse question template (contains '{definition}').

    Returns:
        None.
    """
    original = file_path.read_text(encoding="utf-8")
    header = f"# question_template_forward: {forward}\n# question_template_reverse: {reverse}\n"
    file_path.write_text(header + original, encoding="utf-8")


def _extract_json_object(raw: str) -> dict:
    """
    Robustly extract a JSON object from Claude's response.

    Args:
        raw (str): Raw text content of the model response.

    Returns:
        dict: Parsed JSON object.

    Notes:
        Handles markdown code fences and stray leading/trailing text around
        the JSON, mirroring the parsing approach used in
        scripts/generate_sentences.py.
    """
    raw = raw.strip()
    if "```" in raw:
        for part in raw.split("```"):
            part = part.lstrip("json").strip()
            if part.startswith("{"):
                raw = part
                break
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(raw[start : end + 1])
    raise ValueError(f"Could not parse JSON: {raw[:300]}")


def generate_question_templates(
    subject: str, topic: str, sample_cards: list[tuple[str, str]],
) -> tuple[str, str] | None:
    """
    Generate quiz question phrasing templates for a general-category deck.

    Args:
        subject (str): Deck subject (e.g. 'germany').
        topic (str): Deck topic (e.g. 'subdivisions').
        sample_cards (list[tuple[str, str]]): Up to a handful of (term, definition)
            pairs from the deck, used to infer what relationship the cards encode.

    Returns:
        tuple[str, str] | None: (forward_template, reverse_template). forward
        contains the literal placeholder '{term}' (shown the term, asks for the
        definition); reverse contains '{definition}' (shown the definition, asks
        for the term). None if generation is unavailable or fails validation.

    Notes:
        Never raises — any failure (missing API key, no samples, network error,
        malformed response, missing placeholder) returns None so callers can
        fall back to generic phrasing without interrupting the caller's flow.
    """
    if not settings.ANTHROPIC_API_KEY or not sample_cards:
        return None

    pairs = "\n".join(
        f'{i + 1}. term="{t}"  definition="{d}"' for i, (t, d) in enumerate(sample_cards[:5])
    )
    prompt = (
        f"These are flashcards for a quiz app. Subject: {subject}. Topic: {topic}.\n"
        f"Sample cards:\n{pairs}\n\n"
        "Write two short, natural question templates for quizzing these cards:\n"
        "- 'forward': shown the term, asks for the definition. Must contain the "
        "literal text {term} exactly once, and must NOT contain {definition}.\n"
        "- 'reverse': shown the definition, asks for the term. Must contain the "
        "literal text {definition} exactly once, and must NOT contain {term}.\n\n"
        'Return ONLY a JSON object like: {"forward": "What is the capital of '
        '{term}?", "reverse": "Which German state has {definition} as its capital?"}'
    )

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=300,
            system=(
                "You write concise quiz question templates. Respond only with a "
                "valid JSON object, no markdown, no explanation."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
        data = _extract_json_object(resp.content[0].text)
        forward = data.get("forward", "")
        reverse = data.get("reverse", "")
        if "{term}" not in forward or "{definition}" not in reverse:
            return None
        return forward, reverse
    except Exception:
        return None


def ensure_question_templates(db: Session, deck: Deck) -> None:
    """
    Best-effort: generate and save question templates for a general-category
    deck that doesn't have them yet.

    Args:
        db (Session): SQLAlchemy session.
        deck (Deck): The deck to generate templates for.

    Returns:
        None.

    Notes:
        No-op for language-category decks or decks that already have a
        forward template. Called from the import router (not the lower-level
        import_rows/import_vocab_file service functions) so it only runs for
        real HTTP imports, not the direct service-level calls used throughout
        the test suite.
    """
    if deck.category != "general" or deck.question_template_forward:
        return
    cards = db.query(Card).filter(Card.deck_id == deck.id).limit(5).all()
    sample = [(c.term, c.definition) for c in cards]
    templates = generate_question_templates(deck.subject, deck.topic, sample)
    if templates:
        deck.question_template_forward, deck.question_template_reverse = templates
        db.commit()
