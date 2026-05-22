"""
Text mining service: tokenise pasted foreign text and fetch word meanings.

Latin-script languages (ES, FR, DE, NO): pure Python tokeniser, no AI call.
CJK languages (ZH/Mandarin, JA/Japanese): DeepSeek API call for segmentation
and meanings in one shot.
"""

import json
import re
import unicodedata
from typing import Any

import httpx

from app.config import settings

_CJK_LANGUAGES  = {"mandarin", "japanese"}
_LATIN_LANGUAGES = {"spanish", "french", "german", "norsk"}

_DEEPSEEK_URL = "https://api.deepseek.com/chat/completions"

_CJK_SYSTEM = (
    "You are a language expert. Given a text in {language}, extract every meaningful "
    "vocabulary word and return structured JSON. Include content words (nouns, verbs, "
    "adjectives, adverbs) but omit pure particles, punctuation, and single-character "
    "function words unless they are standalone vocabulary items worth learning."
)

_CJK_USER = """\
Extract vocabulary from this {language} text.

Text:
\"\"\"{text}\"\"\"

Return ONLY a JSON array, no other text. Each element must have exactly these keys:
- "word": the word as it appears ({word_field})
- "native": the reading/pronunciation ({native_field})
- "meaning": English meaning (1-5 words, concise)

Example for {example_lang}:
{example}

JSON array:"""

_CJK_CONFIG = {
    "mandarin": {
        "word_field":   "hanzi characters",
        "native_field": "pinyin with tone marks",
        "example_lang": "Mandarin",
        "example":      '[{"word":"学习","native":"xuéxí","meaning":"to study"},{"word":"朋友","native":"péngyou","meaning":"friend"}]',
    },
    "japanese": {
        "word_field":   "kanji/kana as written",
        "native_field": "romaji reading",
        "example_lang": "Japanese",
        "example":      '[{"word":"勉強","native":"benkyou","meaning":"to study"},{"word":"友達","native":"tomodachi","meaning":"friend"}]',
    },
}


def _normalise(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower().strip()


def _tokenise_latin(text: str) -> list[str]:
    """Split Latin-script text into unique lowercase words, stripping punctuation."""
    words = re.findall(r"[a-zA-ZÀ-ÖØ-öø-ÿ''-]+", text)
    seen: set[str] = set()
    result: list[str] = []
    for w in words:
        key = _normalise(w)
        if len(key) >= 2 and key not in seen:
            seen.add(key)
            result.append(w.lower())
    return result


def _call_deepseek(language: str, text: str) -> list[dict[str, str]]:
    """Call DeepSeek to segment and translate CJK text. Returns list of word dicts."""
    if not settings.DEEPSEEK_API_KEY:
        raise ValueError("DEEPSEEK_API_KEY is not configured.")

    cfg         = _CJK_CONFIG[language]
    system_msg  = _CJK_SYSTEM.format(language=language.capitalize())
    user_msg    = _CJK_USER.format(
        language=language.capitalize(),
        text=text,
        word_field=cfg["word_field"],
        native_field=cfg["native_field"],
        example_lang=cfg["example_lang"],
        example=cfg["example"],
    )

    payload: dict[str, Any] = {
        "model":       settings.DEEPSEEK_MODEL,
        "temperature": 0.1,
        "max_tokens":  2048,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user",   "content": user_msg},
        ],
    }

    with httpx.Client(timeout=30) as client:
        resp = client.post(
            _DEEPSEEK_URL,
            headers={
                "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
                "Content-Type":  "application/json",
            },
            json=payload,
        )
    resp.raise_for_status()

    raw = resp.json()["choices"][0]["message"]["content"].strip()

    # Strip markdown code fences if DeepSeek wraps the JSON
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise ValueError("DeepSeek returned unexpected structure.")

    # Deduplicate by word
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for item in parsed:
        w = str(item.get("word", "")).strip()
        if w and w not in seen:
            seen.add(w)
            result.append({
                "word":    w,
                "native":  str(item.get("native",  "")).strip(),
                "meaning": str(item.get("meaning", "")).strip(),
            })
    return result


def parse_text(
    text: str,
    language: str,
    existing_words: set[str],
) -> dict[str, list[dict]]:
    """
    Tokenise pasted text and split words into new vs already-known buckets.

    Args:
        text (str): Pasted foreign-language text.
        language (str): Language name, lowercase (e.g. 'spanish', 'mandarin').
        existing_words (set[str]): Normalised words already in the user's deck
            for this language — used to flag known vs new.

    Returns:
        dict with keys:
            "new"   — list of {word, native, meaning} not in existing_words
            "known" — list of {word, native, meaning} already in existing_words
            "cjk"   — bool, True if DeepSeek was used

    Notes:
        For Latin languages, meaning and native are empty strings — the user
        fills them in before saving.
        Raises ValueError if CJK and DEEPSEEK_API_KEY is not set.
    """
    language = language.lower().strip()

    if language in _CJK_LANGUAGES:
        tokens = _call_deepseek(language, text)
        cjk    = True
    else:
        raw_tokens = _tokenise_latin(text)
        tokens     = [{"word": w, "native": "", "meaning": ""} for w in raw_tokens]
        cjk        = False

    new:   list[dict] = []
    known: list[dict] = []
    for t in tokens:
        bucket = known if _normalise(t["word"]) in existing_words else new
        bucket.append(t)

    return {"new": new, "known": known, "cjk": cjk}
