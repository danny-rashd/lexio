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
