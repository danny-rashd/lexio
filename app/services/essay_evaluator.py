import json

import anthropic

from app.config import settings

_CLIENT: anthropic.Anthropic | None = None

_SYSTEM_PROMPT = (
    "You are an expert language teacher evaluating essays written by learners. "
    "You give precise, constructive feedback on grammar, spelling, punctuation, "
    "diacritics/accent marks, and fluency. "
    "Always respond with valid JSON only — no markdown, no text outside the JSON object."
)

_USER_TEMPLATE = """\
Evaluate this {language} essay written by a language learner.

Essay:
\"\"\"{text}\"\"\"

Score each of the 5 categories from 0 to 100 and list specific errors.

Scoring rules:
- Grammar (weight 30%): minor error (word order, article) = −3 pts; major error (tense, conjugation, agreement) = −8 pts
- Spelling (weight 20%): each misspelled word = −5 pts
- Punctuation (weight 15%): each error = −4 pts
- Diacritics (weight 20%): missing accent/diacritic (e→é) = −2 pts; wrong diacritic (è→é) = −4 pts; score 100 if language uses no Latin diacritics (Japanese, Mandarin)
- Fluency (weight 15%): holistic score for naturalness, vocabulary range, sentence variety

Return ONLY this JSON (no other text):
{{
  "overall_score": <weighted average as a number 0-100>,
  "categories": {{
    "grammar":     {{"score": <0-100>, "errors": [{{"original": "...", "issue": "...", "correction": "..."}}]}},
    "spelling":    {{"score": <0-100>, "errors": [{{"original": "...", "issue": "...", "correction": "..."}}]}},
    "punctuation": {{"score": <0-100>, "errors": [{{"original": "...", "issue": "...", "correction": "..."}}]}},
    "diacritics":  {{"score": <0-100>, "errors": [{{"original": "...", "issue": "...", "correction": "..."}}]}},
    "fluency":     {{"score": <0-100>, "comment": "one sentence"}}
  }},
  "overall_feedback": "2-3 sentences: what the learner did well and the single most important thing to improve"
}}"""


def _client() -> anthropic.Anthropic:
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _CLIENT


def evaluate_essay(text: str, language: str) -> dict:
    """
    Evaluate a language learner's essay using Claude Haiku.

    Args:
        text (str): The essay text to evaluate.
        language (str): The language the essay is written in (e.g. 'spanish').

    Returns:
        dict: Structured evaluation with overall_score, per-category scores,
              error lists, and overall_feedback.

    Notes:
        Uses prompt caching on the system prompt to reduce cost on repeated calls.
        Raises ValueError if the AI response cannot be parsed as valid JSON.
    """
    prompt = _USER_TEMPLATE.format(language=language.capitalize(), text=text)

    response = _client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=2000,
        system=[
            {
                "type": "text",
                "text": _SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1].lstrip("json").strip() if len(parts) > 1 else raw

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"AI returned invalid JSON: {exc}") from exc
