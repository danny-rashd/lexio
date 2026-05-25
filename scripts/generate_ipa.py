"""
Generate IPA / pronunciation for all vocabulary CSVs.
Uses Claude Haiku in batches of 50 words per API call.
Idempotent — skips rows that already have IPA.

Usage:
    python scripts/generate_ipa.py
    python scripts/generate_ipa.py spanish     # one language only
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
            "For each Spanish word, provide the IPA transcription (International Phonetic Alphabet). "
            "Use standard Castilian Spanish IPA. Keep it concise — just the IPA string, no brackets unless needed."
        ),
        "example": '{"word":"hablar","ipa":"aˈβlaɾ"}',
    },
    "french": {
        "name": "French",
        "instruction": (
            "For each French word, provide the IPA transcription. "
            "Use standard French IPA. Keep it concise — just the IPA string."
        ),
        "example": '{"word":"parler","ipa":"paʁˈle"}',
    },
    "german": {
        "name": "German",
        "instruction": (
            "For each German word, provide the IPA transcription. "
            "Use standard High German IPA. Keep it concise — just the IPA string."
        ),
        "example": '{"word":"sprechen","ipa":"ˈʃpʁɛçən"}',
    },
    "norsk": {
        "name": "Norwegian (Bokmål)",
        "instruction": (
            "For each Norwegian Bokmål word, provide the IPA transcription. "
            "Use standard Eastern Norwegian IPA. Keep it concise — just the IPA string."
        ),
        "example": '{"word":"snakke","ipa":"ˈsnɑkːə"}',
    },
    "japanese": {
        "name": "Japanese",
        "instruction": (
            "For each Japanese word (given as romaji in the 'word' column), provide the pitch accent "
            "notation using the LHL pattern (L=low, H=high) followed by the standard romaji. "
            "Format: pitch pattern + space + romaji. Keep it concise."
        ),
        "example": '{"word":"iru","ipa":"LH iru"}',
    },
    "mandarin": {
        "name": "Mandarin Chinese",
        "instruction": (
            "For each Mandarin Chinese word, provide the pinyin with tone marks. "
            "Use standard pinyin tone marks (ā á ǎ à etc). Just the pinyin, no other text."
        ),
        "example": '{"word":"是","ipa":"shì"}',
    },
}


def _extract_json(raw: str) -> list[dict]:
    import re as _re
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
    for m in _re.finditer(r'\{\s*"word"\s*:\s*"([^"]+)"\s*,\s*"(?:ipa|pinyin)"\s*:\s*"([^"]+)"\s*\}', raw):
        items.append({"word": m.group(1), "ipa": m.group(2)})
    if items:
        return items
    raise ValueError(f"Could not parse JSON: {raw[:300]}")


def _generate_batch(language: str, rows: list[dict]) -> dict[str, str]:
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
        system="You are a linguistics assistant. Respond only with a valid JSON array, no markdown, no explanation.",
        messages=[{"role": "user", "content": prompt}],
    )
    items = _extract_json(resp.content[0].text)
    return {
        item["word"]: item.get("ipa") or item.get("pinyin", "")
        for item in items
        if "word" in item and (item.get("ipa") or item.get("pinyin"))
    }


def _process_file(csv_path: Path, language: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {language.upper()} — {csv_path}")
    print(f"{'='*60}")

    raw_lines = csv_path.read_text(encoding="utf-8").splitlines(keepends=True)

    data_rows: list[dict] = []
    for line in raw_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("word,"):
            continue
        parts = next(csv.reader([stripped]))
        word     = parts[0].strip() if len(parts) > 0 else ""
        meaning  = parts[1].strip() if len(parts) > 1 else ""
        native   = parts[2].strip() if len(parts) > 2 else ""
        sentence = parts[3].strip() if len(parts) > 3 else ""
        ipa      = parts[4].strip() if len(parts) > 4 else ""
        notes    = parts[5].strip() if len(parts) > 5 else ""
        if not word or not meaning:
            continue
        data_rows.append({"word": word, "meaning": meaning, "native": native, "sentence": sentence, "ipa": ipa, "notes": notes})

    todo = [r for r in data_rows if not r["ipa"]]
    already = len(data_rows) - len(todo)
    print(f"  Total rows: {len(data_rows)}  |  Already have IPA: {already}  |  To generate: {len(todo)}")

    if not todo:
        print("  Nothing to do — skipping.")
        return

    ipa_map: dict[str, str] = {}
    for i in range(0, len(todo), _BATCH):
        batch = todo[i : i + _BATCH]
        print(f"  Batch {i//_BATCH + 1}/{(len(todo)-1)//_BATCH + 1}  ({len(batch)} words)...", end=" ", flush=True)
        try:
            result = _generate_batch(language, batch)
            ipa_map.update(result)
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
                out_lines.append("word,meaning,native,sentence,ipa,notes\n")
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
        existing_ipa   = parts[4].strip() if len(parts) > 4 else ""
        existing_notes = parts[5].strip() if len(parts) > 5 else ""

        ipa = existing_ipa or ipa_map.get(word, "")

        sio = io.StringIO()
        csv.writer(sio).writerow([word, meaning, native, sentence, ipa, existing_notes])
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

    print("\nDone. Run 'python scripts/bulk_import.py' to populate IPA into the database.")


if __name__ == "__main__":
    main()
