"""
Generate conjugation / verb-form data for all vocabulary.
- Spanish, French : mlconjug3 (no API calls)
- German, Norwegian, Japanese : Claude Haiku API in batches of 20

Only processes words whose meaning starts with "to " (verb detection).
Idempotent — skips cards that already have conjugation data.

Usage:
    python scripts/generate_conjugations.py
    python scripts/generate_conjugations.py spanish
"""
import json
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic
from app.config import settings
from app.database import SessionLocal
from app.models.card import Card, Deck
from app.models.conjugation import Conjugation

_CLIENT = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
_MODEL  = "claude-haiku-4-5-20251001"

_ES_PERSONS = ["yo", "tú", "él/ella", "nosotros", "vosotros", "ellos/ellas"]
_FR_PERSONS = ["je", "tu", "il/elle", "nous", "vous", "ils/elles"]
_DE_PERSONS = ["ich", "du", "er/sie", "wir", "ihr", "sie/Sie"]
_NO_PERSONS = ["jeg", "du", "han/hun", "vi", "dere", "de"]
_PERSON_KEYS = ["1s", "2s", "3s", "1p", "2p", "3p"]


# ── mlconjug3 helpers ─────────────────────────────────────────────────────────

def _mlconjug_extract(verb: str, language: str) -> dict | None:
    try:
        import mlconjug3
        lang_code = "es" if language == "spanish" else "fr"
        conj = mlconjug3.Conjugator(language=lang_code)
        result = conj.conjugate(verb)
        info = result.conjug_info
    except Exception:
        return None

    persons = _ES_PERSONS if language == "spanish" else _FR_PERSONS

    def _forms(mood: str, tense: str) -> list[dict] | None:
        try:
            raw = info[mood][tense]
            if not isinstance(raw, dict):
                return None
            out = []
            for key, person in zip(_PERSON_KEYS, persons):
                form = raw.get(key, "")
                if not form:
                    return None
                out.append({"person": person, "form": form})
            return out
        except (KeyError, TypeError):
            return None

    if language == "spanish":
        tense_map = [
            ("present",     "Indicativo", "Indicativo presente"),
            ("preterite",   "Indicativo", "Indicativo pretérito perfecto simple"),
            ("imperfect",   "Indicativo", "Indicativo pretérito imperfecto"),
            ("future",      "Indicativo", "Indicativo futuro"),
            ("conditional", "Condicional", "Condicional Condicional"),
            ("subjunctive", "Subjuntivo", "Subjuntivo presente"),
        ]
        labels = {
            "present": "Presente", "preterite": "Pretérito indefinido",
            "imperfect": "Pretérito imperfecto", "future": "Futuro",
            "conditional": "Condicional", "subjunctive": "Subjuntivo presente",
        }
    else:
        tense_map = [
            ("present",     "Indicatif", "Présent"),
            ("imperfect",   "Indicatif", "Imparfait"),
            ("past",        "Indicatif", "Passé Simple"),
            ("future",      "Indicatif", "Futur"),
            ("conditional", "Conditionnel", "Présent"),
            ("subjunctive", "Subjonctif", "Présent"),
        ]
        labels = {
            "present": "Présent", "imperfect": "Imparfait",
            "past": "Passé simple", "future": "Futur",
            "conditional": "Conditionnel", "subjunctive": "Subjonctif présent",
        }

    tenses = []
    for key, mood, tense in tense_map:
        forms = _forms(mood, tense)
        if forms:
            tenses.append({"key": key, "label": labels[key], "forms": forms})

    if not tenses:
        return None
    return {"language": language, "tenses": tenses}


# ── Claude API helpers ────────────────────────────────────────────────────────

_DE_PROMPT = """For each German verb, provide a conjugation table with these tenses:
Präsens, Präteritum, Perfekt (with auxiliary), Futur I, Konjunktiv II.
Persons: ich, du, er/sie, wir, ihr, sie/Sie.

Return ONLY a JSON array. Each element:
{"verb": "gehen", "tenses": [
  {"key": "present", "label": "Präsens", "forms": [
    {"person": "ich", "form": "gehe"},
    {"person": "du", "form": "gehst"},
    {"person": "er/sie", "form": "geht"},
    {"person": "wir", "form": "gehen"},
    {"person": "ihr", "form": "geht"},
    {"person": "sie/Sie", "form": "gehen"}
  ]},
  ...more tenses...
]}

Verbs:
"""

_NO_PROMPT = """For each Norwegian Bokmål verb, provide a conjugation table with these tenses:
Presens, Preteritum, Perfektum (with auxiliary), Futurum (skal/vil + infinitiv), Kondisjonalis.
Persons: jeg, du, han/hun, vi, dere, de.

Return ONLY a JSON array. Each element:
{"verb": "snakke", "tenses": [
  {"key": "present", "label": "Presens", "forms": [
    {"person": "jeg", "form": "snakker"},
    {"person": "du", "form": "snakker"},
    {"person": "han/hun", "form": "snakker"},
    {"person": "vi", "form": "snakker"},
    {"person": "dere", "form": "snakker"},
    {"person": "de", "form": "snakker"}
  ]},
  ...more tenses...
]}

Verbs:
"""

_JP_PROMPT = """For each Japanese verb (given as romaji), provide the key verb forms in hiragana/kanji.
Return ONLY a JSON array. Each element:
{"verb": "iru", "verb_class": "る-verb", "tenses": [
  {"key": "dictionary",  "label": "辞書形",         "forms": [{"person": "", "form": "いる"}]},
  {"key": "te_form",     "label": "て形",            "forms": [{"person": "", "form": "いて"}]},
  {"key": "ta_form",     "label": "た形 (past)",     "forms": [{"person": "", "form": "いた"}]},
  {"key": "nai_form",    "label": "ない形 (neg.)",   "forms": [{"person": "", "form": "いない"}]},
  {"key": "masu_form",   "label": "ます形 (polite)", "forms": [{"person": "", "form": "います"}]},
  {"key": "potential",   "label": "可能形",           "forms": [{"person": "", "form": "いられる"}]},
  {"key": "passive",     "label": "受身形",           "forms": [{"person": "", "form": "いられる"}]},
  {"key": "causative",   "label": "使役形",           "forms": [{"person": "", "form": "いさせる"}]},
  {"key": "volitional",  "label": "意向形",           "forms": [{"person": "", "form": "いよう"}]}
]}

Verbs:
"""

_LANG_PROMPT = {"german": _DE_PROMPT, "norsk": _NO_PROMPT, "japanese": _JP_PROMPT}


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
    # Truncated response: walk chars and collect complete top-level objects
    if start != -1:
        depth = 0
        in_str = False
        escape = False
        objects: list[dict] = []
        obj_start = -1
        for i, ch in enumerate(raw[start:], start):
            if escape:
                escape = False
                continue
            if ch == "\\" and in_str:
                escape = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                if depth == 1:
                    obj_start = i
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 1 and obj_start != -1:
                    try:
                        objects.append(json.loads(raw[obj_start : i + 1]))
                    except json.JSONDecodeError:
                        pass
                    obj_start = -1
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
        if objects:
            return objects
    raise ValueError(f"Could not parse JSON: {raw[:300]}")


def _generate_api_batch(language: str, rows: list[dict]) -> list[dict | None]:
    """Returns a list aligned with rows; None for each item that could not be generated."""
    prompt_prefix = _LANG_PROMPT[language]
    word_list = "\n".join(
        f'{i+1}. verb="{r["word"]}"  meaning="{r["meaning"]}"'
        + (f'  native="{r["native"]}"' if r.get("native") else "")
        for i, r in enumerate(rows)
    )
    for attempt in range(3):
        try:
            resp = _CLIENT.messages.create(
                model=_MODEL,
                max_tokens=8192,
                system="You are a language education assistant. Respond only with a valid JSON array, no markdown, no explanation.",
                messages=[{"role": "user", "content": prompt_prefix + word_list}],
            )
            break
        except Exception as exc:
            if "rate_limit" in str(exc).lower() and attempt < 2:
                wait = 60 * (attempt + 1)
                print(f"rate limit, sleeping {wait}s...", end=" ", flush=True)
                time.sleep(wait)
            else:
                raise
    items = [i for i in _extract_json(resp.content[0].text) if "verb" in i and "tenses" in i]

    result: list[dict | None] = [None] * len(rows)
    word_to_idx = {r["word"]: i for i, r in enumerate(rows)}
    unmatched: list[dict] = []

    for item in items:
        idx = word_to_idx.get(item["verb"])
        if idx is not None and result[idx] is None:
            result[idx] = {"language": language, "tenses": item["tenses"],
                           **({"verb_class": item["verb_class"]} if "verb_class" in item else {})}
        else:
            unmatched.append(item)

    # Positional fallback for items the model returned with a different key
    empty_slots = [i for i, v in enumerate(result) if v is None]
    for slot, item in zip(empty_slots, unmatched):
        result[slot] = {"language": language, "tenses": item["tenses"],
                        **({"verb_class": item["verb_class"]} if "verb_class" in item else {})}

    return result


# ── Main processing ───────────────────────────────────────────────────────────

def _is_verb(meaning: str) -> bool:
    return meaning.strip().lower().startswith("to ")


def _process_language(db, language: str, use_api: bool, batch_size: int = 20) -> None:
    print(f"\n{'='*60}")
    print(f"  {language.upper()}")
    print(f"{'='*60}")

    deck = db.query(Deck).filter(Deck.language == language).first()
    if not deck:
        print("  No deck found — skipping.")
        return

    existing_card_ids = {
        row[0] for row in
        db.query(Conjugation.card_id).all()
    }

    verb_cards = [
        c for c in
        db.query(Card).filter(Card.deck_id == deck.id, Card.is_active.is_(True)).all()
        if _is_verb(c.meaning) and c.id not in existing_card_ids
    ]
    already = db.query(Conjugation).join(Card).filter(
        Card.deck_id == deck.id, Card.meaning.ilike("to %")
    ).count()

    print(f"  Verbs to process: {len(verb_cards)}  |  Already done: {already}")

    if not verb_cards:
        print("  Nothing to do — skipping.")
        return

    inserted = 0

    if not use_api:
        for card in verb_cards:
            data = _mlconjug_extract(card.word, language)
            if data:
                db.add(Conjugation(card_id=card.id, data=json.dumps(data, ensure_ascii=False)))
                inserted += 1
        db.commit()
        print(f"  Inserted {inserted} conjugation records.")
        return

    for i in range(0, len(verb_cards), batch_size):
        batch = verb_cards[i : i + batch_size]
        rows = [{"word": c.word, "meaning": c.meaning, "native": c.native} for c in batch]
        print(f"  Batch {i//batch_size + 1}/{(len(verb_cards)-1)//batch_size + 1}  ({len(batch)} verbs)...", end=" ", flush=True)
        try:
            results = _generate_api_batch(language, rows)
            for card, data in zip(batch, results):
                if data:
                    db.add(Conjugation(card_id=card.id, data=json.dumps(data, ensure_ascii=False)))
                    inserted += 1
            db.commit()
            print(f"got {sum(1 for r in results if r)}")
        except Exception as exc:
            print(f"ERROR: {exc}")
        if i + batch_size < len(verb_cards):
            time.sleep(1)

    print(f"  Total inserted: {inserted}")


def main() -> None:
    target = sys.argv[1].lower() if len(sys.argv) > 1 else None

    languages = [
        ("spanish",  False),
        ("french",   False),
        ("german",   True),
        ("norsk",    True),
        ("japanese", True),
    ]

    db = SessionLocal()
    try:
        for language, use_api in languages:
            if target and language != target:
                continue
            _process_language(db, language, use_api, batch_size=8 if use_api else 20)
    finally:
        db.close()

    print("\nDone.")


if __name__ == "__main__":
    main()
