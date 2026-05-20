import unicodedata


def normalize_text(text: str) -> str:
    """
    Strip diacritics, lowercase, and strip whitespace for comparison.

    Args:
        text (str): Raw input string.

    Returns:
        str: ASCII-folded, lowercased, stripped string.

    Notes:
        Uses unicodedata.normalize('NFKD') + encode/decode ascii ignore.
        This is the canonical form used for idempotency keys and answer
        matching across all languages. Examples: café→cafe, å→a, nǐ→ni,
        kjærlighet→kjrlighet (non-ASCII letters dropped, not transliterated).
    """
    return (
        unicodedata.normalize("NFKD", text)
        .encode("ascii", "ignore")
        .decode()
        .lower()
        .strip()
    )


def normalize_deck_label(label: str) -> str:
    """
    Normalize a language or topic label for consistent storage.

    Args:
        label (str): Raw language or topic string from user input or file path.

    Returns:
        str: Lowercased, stripped string (e.g. 'Spanish ' → 'spanish').

    Notes:
        Applied to both language and topic on every import and deck creation
        so that 'Spanish', 'spanish', and '  Spanish  ' all resolve to the
        same deck. Called in the service layer — not the router — so the
        normalization is enforced even on direct API calls.
    """
    return label.lower().strip()
