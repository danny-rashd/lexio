import json

import anthropic
from langdetect import LangDetectException, detect_langs

from app.config import settings

# Map app language names → accepted langdetect codes
_LANG_CODES: dict[str, list[str]] = {
    "spanish":  ["es"],
    "french":   ["fr"],
    "german":   ["de"],
    "norsk":    ["no", "nb", "nn", "da"],  # Danish is nearly identical; avoid false positives
    "japanese": ["ja"],
    "mandarin": ["zh-cn", "zh-tw", "zh"],
}

# Human-readable names for detected codes shown in warnings
_CODE_TO_NAME: dict[str, str] = {
    "es": "Spanish",   "fr": "French",    "de": "German",
    "no": "Norwegian", "nb": "Norwegian", "nn": "Norwegian", "da": "Danish",
    "ja": "Japanese",  "zh-cn": "Mandarin", "zh-tw": "Mandarin", "zh": "Mandarin",
    "en": "English",   "pt": "Portuguese", "it": "Italian",
    "nl": "Dutch",     "sv": "Swedish",    "ko": "Korean",
    "ru": "Russian",   "ar": "Arabic",     "pl": "Polish",
}

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


def check_language(text: str, expected_language: str) -> dict:
    """
    Detect the language of the submitted text and compare against the selected language.

    Args:
        text (str): Essay text to inspect.
        expected_language (str): App language name (e.g. 'french').

    Returns:
        dict with keys:
            match (bool): True if detected language is consistent with expected.
            confidence (float): Probability of the top detected language (0–1).
            detected (str | None): Human-readable name of detected language,
                or None if detection failed or matched.

    Notes:
        Detection is skipped (match=True) for unsupported language names.
        langdetect can be unreliable on very short texts; confidence < 0.60
        is treated as inconclusive and should not trigger a hard block.
    """
    expected_codes = _LANG_CODES.get(expected_language.lower(), [])
    if not expected_codes:
        return {"match": True, "confidence": 1.0, "detected": None}

    try:
        results = detect_langs(text)
    except LangDetectException:
        return {"match": True, "confidence": 0.0, "detected": None}

    if not results:
        return {"match": True, "confidence": 0.0, "detected": None}

    top = results[0]
    if top.lang in expected_codes:
        return {"match": True, "confidence": top.prob, "detected": None}

    detected_name = _CODE_TO_NAME.get(top.lang, top.lang.upper())
    return {"match": False, "confidence": top.prob, "detected": detected_name}


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
