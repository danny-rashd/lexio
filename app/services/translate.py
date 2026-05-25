import re

import httpx

_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"

SUPPORTED_CODES = {"en", "es", "fr", "de", "no", "ja", "zh"}


def translate_text(text: str, source: str, target: str, api_key: str) -> str:
    """
    Translate text using Google Cloud Translation API v2.

    Args:
        text (str): Text to translate.
        source (str): BCP-47 source language code (e.g. 'en').
        target (str): BCP-47 target language code (e.g. 'es').
        api_key (str): Google Cloud API key with Translation API enabled.

    Returns:
        str: Translated text.

    Notes:
        Supported codes: en, es, fr, de, no, ja, zh.
        Raises httpx.HTTPStatusError on non-2xx responses from Google.
    """
    response = httpx.post(
        _TRANSLATE_URL,
        params={"key": api_key},
        json={"q": text, "source": source, "target": target, "format": "text"},
        timeout=10.0,
    )
    response.raise_for_status()
    return response.json()["data"]["translations"][0]["translatedText"]


def romanize(text: str, lang_code: str) -> str | None:
    """
    Return romanization for Japanese (Hepburn romaji) or Mandarin (pinyin).

    Args:
        text (str): Text in Japanese or Mandarin script.
        lang_code (str): 'ja' for Japanese, 'zh' for Mandarin.

    Returns:
        str | None: Romanized string, or None for unsupported languages.

    Notes:
        Uses pykakasi for Japanese and pypinyin for Mandarin — both offline,
        no API calls required.
    """
    if lang_code == "ja":
        try:
            import pykakasi
            kks = pykakasi.kakasi()
            return " ".join(item["hepburn"] for item in kks.convert(text) if item["hepburn"])
        except Exception:
            return None
    if lang_code == "zh":
        try:
            from pypinyin import lazy_pinyin, Style
            return " ".join(lazy_pinyin(text, style=Style.TONE))
        except Exception:
            return None
    return None


def batch_translate_to_english(words: list[str], source_code: str, api_key: str) -> list[str]:
    """
    Translate a list of words from source_code to English in one API call.

    Args:
        words (list[str]): Words to translate.
        source_code (str): BCP-47 source language code (e.g. 'es').
        api_key (str): Google Cloud API key.

    Returns:
        list[str]: Translated meanings aligned with input words.

    Notes:
        Raises httpx.HTTPStatusError on non-2xx responses from Google.
    """
    response = httpx.post(
        _TRANSLATE_URL,
        params={"key": api_key},
        json={"q": words, "source": source_code, "target": "en", "format": "text"},
        timeout=15.0,
    )
    response.raise_for_status()
    return [t["translatedText"] for t in response.json()["data"]["translations"]]


def split_words(text: str, lang_code: str = "") -> list[str]:
    """
    Split text into unique words by whitespace and punctuation, excluding numbers.

    Args:
        text (str): Source text to split.
        lang_code (str): BCP-47 language code (e.g. 'de', 'es'). German ('de')
            preserves original casing so noun capitalisation is retained;
            all other languages are lowercased.

    Returns:
        list[str]: Unique words with length > 1, in order of first appearance.
        Pure-numeric and non-alphabetic tokens are excluded.

    Notes:
        Single characters are excluded. Deduplication is always case-insensitive;
        first occurrence wins.
    """
    preserve_case = lang_code.lower() == "de"
    tokens = re.split(r"[\s,\.!?;:'\"()\[\]{}<>/\\|@#$%^&*+=~`]+", text)
    seen: set[str] = set()
    result: list[str] = []
    for token in tokens:
        token = token.strip("-–—")
        if len(token) < 2:
            continue
        if not re.search(r'[a-zA-ZÀ-ÖØ-öø-ÿ]', token):
            continue
        key = token.lower()
        if key not in seen:
            seen.add(key)
            result.append(token if preserve_case else key)
    return result
