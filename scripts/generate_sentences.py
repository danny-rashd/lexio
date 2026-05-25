"""
Generate {{word}} example sentences for all vocabulary CSVs.
Uses Claude Haiku in batches of 50 words per API call.
Idempotent — skips rows that already have a sentence.

Usage:
    python scripts/generate_sentences.py
    python scripts/generate_sentences.py spanish     # one language only
"""
import csv
import io
import json
import sys
import time
from pathlib import Path

import anthropic

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings

_CLIENT = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
_MODEL  = "claude-haiku-4-5-20251001"
_BATCH  = 50

_LANG_CFG = {
    "spanish": {
        "name": "Spanish",
        "instruction": (
            "Write one short, natural Spanish sentence for each word. "
            "The word or a naturally inflected form must appear in the sentence wrapped in {{double curly braces}}. "
            "Sentences should be 5–12 words."
        ),
        "example": '{"word":"ser","sentence":"Ella quiere {{ser}} médica algún día."}',
    },
    "french": {
        "name": "French",
        "instruction": (
            "Write one short, natural French sentence for each word. "
            "The word or a naturally inflected form must appear in the sentence wrapped in {{double curly braces}}. "
            "Sentences should be 5–12 words."
        ),
        "example": '{"word":"parler","sentence":"Il aime {{parler}} avec ses amis."}',
    },
    "german": {
        "name": "German",
        "instruction": (
            "Write one short, natural German sentence for each word. "
            "The word or a naturally inflected form must appear in the sentence wrapped in {{double curly braces}}. "
            "Sentences should be 5–12 words."
        ),
        "example": '{"word":"haben","sentence":"Wir {{haben}} heute keine Zeit."}',
    },
    "norsk": {
        "name": "Norwegian (Bokmål)",
        "instruction": (
            "Write one short, natural Norwegian Bokmål sentence for each word. "
            "The word or a naturally inflected form must appear in the sentence wrapped in {{double curly braces}}. "
            "Sentences should be 5–12 words."
        ),
        "example": '{"word":"snakke","sentence":"Vi {{snakker}} norsk hjemme hver dag."}',
    },
    "japanese": {
        "name": "Japanese",
        "instruction": (
            "Write one short, natural Japanese sentence for each word. "
            "Use hiragana/kanji. The Japanese (kana/kanji) form of the word — shown in the 'native' column — "
            "must appear in the sentence wrapped in {{double curly braces}}. "
            "The student will type the romaji answer shown in the 'word' column. "
            "Sentences should be 5–10 words."
        ),
        "example": '{"word":"iru","sentence":"猫がここに{{いる}}。"}',
    },
    "mandarin": {
        "name": "Mandarin Chinese",
        "instruction": (
            "Write one short, natural Mandarin Chinese sentence for each word. "
            "The character(s) from the 'word' column must appear in the sentence wrapped in {{double curly braces}}. "
            "Sentences should be 5–12 characters."
        ),
        "example": '{"word":"是","sentence":"他{{是}}我最好的朋友。"}',
    },
}


def _extract_json(raw: str) -> list[dict]:
    """Robustly extract a JSON array from Claude's response."""
    import re as _re
    raw = raw.strip()

    # Strip markdown code fences
    if "```" in raw:
        for part in raw.split("```"):
            part = part.lstrip("json").strip()
            if part.startswith("["):
                raw = part
                break

    # Direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Find the outermost [...] and try again
    start = raw.find("[")
    end   = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    # Last resort: pull individual objects via regex (handles truncated/malformed arrays)
    items = []
    for m in _re.finditer(r'\{\s*"word"\s*:\s*"([^"]+)"\s*,\s*"sentence"\s*:\s*"([^"]+)"\s*\}', raw):
        items.append({"word": m.group(1), "sentence": m.group(2)})
    if items:
        return items

    raise ValueError(f"Could not parse JSON: {raw[:300]}")


def _generate_batch(language: str, rows: list[dict]) -> dict[str, str]:
    """Call Claude Haiku for a batch of rows. Returns {word: sentence}."""
    cfg = _LANG_CFG[language]

    word_list = "\n".join(
        f'{i+1}. word="{r["word"]}"  meaning="{r["meaning"]}"'
        + (f'  native="{r["native"]}"' if r.get("native") else "")
        for i, r in enumerate(rows)
    )

    prompt = (
        f"{cfg['instruction']}\n\n"
        f"Return ONLY a JSON array. Example element: {cfg['example']}\n\n"
        f"Words ({cfg['name']}):\n{word_list}"
    )

    resp = _CLIENT.messages.create(
        model=_MODEL,
        max_tokens=8192,
        system=(
            "You are a language education assistant. "
            "Respond only with a valid JSON array, no markdown, no explanation."
        ),
        messages=[{"role": "user", "content": prompt}],
    )

    items = _extract_json(resp.content[0].text)
    return {item["word"]: item["sentence"] for item in items if "word" in item and "sentence" in item}


def _process_file(csv_path: Path, language: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {language.upper()} — {csv_path}")
    print(f"{'='*60}")

    # Read existing content preserving structure
    raw_lines = csv_path.read_text(encoding="utf-8").splitlines(keepends=True)

    # Parse data rows
    data_rows: list[dict] = []
    for line in raw_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("word,"):
            continue
        parts = next(csv.reader([stripped]))
        word    = parts[0].strip() if len(parts) > 0 else ""
        meaning = parts[1].strip() if len(parts) > 1 else ""
        native  = parts[2].strip() if len(parts) > 2 else ""
        sentence = parts[3].strip() if len(parts) > 3 else ""
        if not word or not meaning:
            continue
        data_rows.append({"word": word, "meaning": meaning, "native": native, "sentence": sentence})

    # Find rows that need sentences
    todo = [r for r in data_rows if not r["sentence"]]
    already = len(data_rows) - len(todo)
    print(f"  Total rows: {len(data_rows)}  |  Already have sentence: {already}  |  To generate: {len(todo)}")

    if not todo:
        print("  Nothing to do — skipping.")
        return

    # Generate in batches
    sentence_map: dict[str, str] = {}
    for i in range(0, len(todo), _BATCH):
        batch = todo[i : i + _BATCH]
        print(f"  Batch {i//_BATCH + 1}/{(len(todo)-1)//_BATCH + 1}  ({len(batch)} words)...", end=" ", flush=True)
        try:
            result = _generate_batch(language, batch)
            sentence_map.update(result)
            print(f"got {len(result)}")
        except Exception as exc:
            print(f"ERROR: {exc}")
        if i + _BATCH < len(todo):
            time.sleep(1)  # brief pause between batches

    # Rewrite the CSV with sentences
    out_lines: list[str] = []
    for line in raw_lines:
        stripped = line.strip()

        # Header line — ensure 4 columns
        if stripped.startswith("word,"):
            if "sentence" not in stripped:
                out_lines.append("word,meaning,native,sentence\n")
            else:
                out_lines.append(line if line.endswith("\n") else line + "\n")
            continue

        # Comments and blank lines — pass through
        if not stripped or stripped.startswith("#"):
            out_lines.append(line if line.endswith("\n") else line + "\n")
            continue

        # Data line
        parts = next(csv.reader([stripped]))
        word    = parts[0].strip() if len(parts) > 0 else ""
        meaning = parts[1].strip() if len(parts) > 1 else ""
        native  = parts[2].strip() if len(parts) > 2 else ""
        existing_sentence = parts[3].strip() if len(parts) > 3 else ""

        sentence = existing_sentence or sentence_map.get(word, "")

        sio = io.StringIO()
        csv.writer(sio).writerow([word, meaning, native, sentence])
        out_lines.append(sio.getvalue())

    csv_path.write_text("".join(out_lines), encoding="utf-8")
    print(f"  Written {csv_path.name}")


def main() -> None:
    data_dir = Path(settings.DATA_DIR)
    target = sys.argv[1].lower() if len(sys.argv) > 1 else None

    for lang_dir in sorted(data_dir.iterdir()):
        if not lang_dir.is_dir():
            continue
        language = lang_dir.name
        if target and language != target:
            continue
        if language not in _LANG_CFG:
            print(f"Skipping unknown language: {language}")
            continue

        for csv_file in sorted(lang_dir.rglob("*.csv")):
            _process_file(csv_file, language)

    print("\nDone. Run 'python scripts/bulk_import.py' to populate sentences into the database.")


if __name__ == "__main__":
    main()
