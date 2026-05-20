import random
import string


_PUNCTUATION = set(string.punctuation + " ")


def _maskable_indices(answer: str) -> list[int]:
    return [i for i, c in enumerate(answer) if c.isalpha()]


def generate_letter_mask(answer: str, revealed: set[int]) -> str:
    """
    Build the masked answer string given a set of already-revealed indices.

    Args:
        answer (str): The correct answer string to mask.
        revealed (set[int]): Character indices that have been revealed so far.

    Returns:
        str: The answer with unrevealed letters replaced by '_'. Spaces and
        punctuation are always shown regardless of revealed set.

    Notes:
        Only alphabetic characters are masked — spaces, digits, and punctuation
        are always visible. This means 'thank you' shows as 't___k _o_' rather
        than masking the space.
    """
    result = []
    for i, c in enumerate(answer):
        if not c.isalpha():
            result.append(c)
        elif i in revealed:
            result.append(c)
        else:
            result.append("_")
    return "".join(result)


def next_reveal(answer: str, revealed: set[int]) -> int | None:
    """
    Pick the next character index to reveal.

    Args:
        answer (str): The correct answer string.
        revealed (set[int]): Indices already revealed.

    Returns:
        int | None: A randomly chosen unrevealed alphabetic index, or None
        if all alphabetic positions are already revealed.

    Notes:
        Only selects from alphabetic positions — spaces and punctuation are
        never in the reveal pool since they are always visible.
        The caller is responsible for the first-press special case: revealing
        the first and last alphabetic positions before calling next_reveal.
    """
    unrevealed = [i for i in _maskable_indices(answer) if i not in revealed]
    if not unrevealed:
        return None
    return random.choice(unrevealed)


def first_and_last(answer: str) -> set[int]:
    """
    Return the indices of the first and last alphabetic characters.

    Args:
        answer (str): The correct answer string.

    Returns:
        set[int]: Indices of the first and last maskable positions. Returns
        an empty set if the answer has no alphabetic characters.

    Notes:
        Called by the quiz router on the first hint press to pre-reveal
        the boundary letters before handing off to next_reveal for subsequent
        presses. If the answer has only one alphabetic character, the set
        contains a single index.
    """
    indices = _maskable_indices(answer)
    if not indices:
        return set()
    return {indices[0], indices[-1]}
