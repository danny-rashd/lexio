import base64

import httpx

# (language_name → (BCP-47 code, Neural2 voice name))
# Norwegian has no Neural2 voice; WaveNet is used instead.
_VOICE_MAP: dict[str, tuple[str, str]] = {
    "english":  ("en-US", "en-US-Neural2-A"),
    "spanish":  ("es-ES", "es-ES-Neural2-A"),
    "french":   ("fr-FR", "fr-FR-Neural2-A"),
    "german":   ("de-DE", "de-DE-Neural2-A"),
    "norsk":    ("nb-NO", "nb-NO-Wavenet-A"),
    "japanese": ("ja-JP", "ja-JP-Neural2-B"),
    "mandarin": ("cmn-CN", "cmn-CN-Wavenet-A"),
}

_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize"


def synthesize_speech(text: str, language: str, api_key: str) -> bytes:
    """
    Call Google Cloud Text-to-Speech and return raw MP3 bytes.

    Args:
        text (str): The word or phrase to synthesize.
        language (str): Language name as used in Lexio (e.g. 'japanese').
        api_key (str): Google Cloud TTS API key.

    Returns:
        bytes: MP3 audio data ready to stream to the client.

    Notes:
        Uses Neural2 voices for all languages except Norwegian (WaveNet).
        Raises httpx.HTTPStatusError on non-2xx responses from Google.
    """
    lang_code, voice_name = _VOICE_MAP.get(language.lower(), ("en-US", "en-US-Neural2-A"))

    payload = {
        "input": {"text": text},
        "voice": {"languageCode": lang_code, "name": voice_name},
        "audioConfig": {"audioEncoding": "MP3"},
    }

    response = httpx.post(
        _TTS_URL,
        params={"key": api_key},
        json=payload,
        timeout=10.0,
    )
    response.raise_for_status()
    return base64.b64decode(response.json()["audioContent"])
