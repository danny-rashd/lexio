"""
Generate Chineasy-style mnemonic notes for Mandarin vocabulary CSVs.
Uses Claude Haiku in batches of 50 words per API call.
Idempotent — skips rows that already have notes.

Only runs for Mandarin — other languages use manually entered notes.

Usage:
    python scripts/generate_notes.py
"""
import csv
import io
import json
import re
import sys
import time
from pathlib import Path

import anthropic

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.config import settings

_CLIENT = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
_MODEL  = "claude-haiku-4-5-20251001"
_BATCH  = 50


def _extract_json(raw: str) -> list[dict]:
    raw = raw.strip()
    if "```" in raw:
        for part in raw.split("```"):
            part = part.lstrip("json").strip()
            if part.startswith("["):
                raw = part
                break
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    start = raw.find("[")
    end   = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass
    items = []
    for m in re.finditer(r'\{\s*"word"\s*:\s*"([^"]+)"\s*,\s*"notes"\s*:\s*"([^"]+)"\s*\}', raw):
        items.append({"word": m.group(1), "notes": m.group(2)})
    if items:
        return items
    raise ValueError(f"Could not parse JSON: {raw[:300]}")


def _generate_batch(rows: list[dict]) -> dict[str, str]:
    word_list = "\n".join(
        f'{i+1}. word="{r["word"]}"  meaning="{r["meaning"]}"'
        for i, r in enumerate(rows)
    )
    prompt = (
        "For each Mandarin Chinese character or word, write a short Chineasy-style mnemonic. "
        "Break down the character into its visual components or radicals and create a memorable story. "
        "Keep it to 1-2 sentences max. Focus on visual or phonetic memory hooks.\n\n"
        "Return ONLY a JSON array. Example element: "
        '{"word":"明","notes":"Sun (日) + Moon (月) = bright — two light sources together."}\n\n'
        f"Words (Mandarin Chinese):\n{word_list}"
    )
    resp = _CLIENT.messages.create(
        model=_MODEL,
        max_tokens=8192,
        system="You are a language education assistant specializing in Chinese character mnemonics. "
               "Respond only with a valid JSON array, no markdown, no explanation.",
        messages=[{"role": "user", "content": prompt}],
    )
    items = _extract_json(resp.content[0].text)
    return {item["word"]: item["notes"] for item in items if "word" in item and "notes" in item}


def _process_file(csv_path: Path) -> None:
    print(f"\n{'='*60}")
    print(f"  MANDARIN — {csv_path}")
    print(f"{'='*60}")

    raw_lines = csv_path.read_text(encoding="utf-8").splitlines(keepends=True)

    data_rows: list[dict] = []
    for line in raw_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("word,"):
            continue
        parts = next(csv.reader([stripped]))
        word  = parts[0].strip() if len(parts) > 0 else ""
        meaning = parts[1].strip() if len(parts) > 1 else ""
        notes   = parts[5].strip() if len(parts) > 5 else ""
        if not word or not meaning:
            continue
        data_rows.append({"word": word, "meaning": meaning, "notes": notes})

    todo = [r for r in data_rows if not r["notes"]]
    already = len(data_rows) - len(todo)
    print(f"  Total rows: {len(data_rows)}  |  Already have notes: {already}  |  To generate: {len(todo)}")

    if not todo:
        print("  Nothing to do — skipping.")
        return

    notes_map: dict[str, str] = {}
    for i in range(0, len(todo), _BATCH):
        batch = todo[i : i + _BATCH]
        print(f"  Batch {i//_BATCH + 1}/{(len(todo)-1)//_BATCH + 1}  ({len(batch)} words)...", end=" ", flush=True)
        try:
            result = _generate_batch(batch)
            notes_map.update(result)
            print(f"got {len(result)}")
        except Exception as exc:
            print(f"ERROR: {exc}")
        if i + _BATCH < len(todo):
            time.sleep(1)

    out_lines: list[str] = []
    for line in raw_lines:
        stripped = line.strip()

        if stripped.startswith("word,"):
            cols = stripped.split(",")
            if len(cols) < 6:
                # Pad header to 6 columns
                header = cols + [""] * (6 - len(cols))
                header[5] = "notes"
                out_lines.append(",".join(header) + "\n")
            else:
                out_lines.append(line if line.endswith("\n") else line + "\n")
            continue

        if not stripped or stripped.startswith("#"):
            out_lines.append(line if line.endswith("\n") else line + "\n")
            continue

        parts = next(csv.reader([stripped]))
        word     = parts[0].strip() if len(parts) > 0 else ""
        meaning  = parts[1].strip() if len(parts) > 1 else ""
        native   = parts[2].strip() if len(parts) > 2 else ""
        sentence = parts[3].strip() if len(parts) > 3 else ""
        ipa      = parts[4].strip() if len(parts) > 4 else ""
        existing_notes = parts[5].strip() if len(parts) > 5 else ""

        notes = existing_notes or notes_map.get(word, "")

        sio = io.StringIO()
        csv.writer(sio).writerow([word, meaning, native, sentence, ipa, notes])
        out_lines.append(sio.getvalue())

    csv_path.write_text("".join(out_lines), encoding="utf-8")
    print(f"  Written {csv_path.name}")


def main() -> None:
    data_dir = Path(settings.DATA_DIR)
    mandarin_dir = data_dir / "mandarin"
    if not mandarin_dir.exists():
        print("No mandarin directory found.")
        return
    for csv_file in sorted(mandarin_dir.rglob("*.csv")):
        _process_file(csv_file)
    print("\nDone. Run 'python scripts/bulk_import.py' to populate notes into the database.")


if __name__ == "__main__":
    main()
