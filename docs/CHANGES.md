# Post-launch changes

## French and German support (2026-05-21)

Added French (FR) and German (DE) as supported languages.

- `app/static/app.js` — added `FR` and `DE` to `LANG` constants and `SUPPORTED_LANGS`
- `app/static/style.css` — added `.pill-fr` (blue `#0055A4`) and `.pill-de` (amber `#E67700`)
- `app/static/index.html` — FR and DE pills added to login page decoration
- `data/languages/french/greetings/basics.csv` — 20 greetings
- `data/languages/french/food/food.csv` — 20 food words
- `data/languages/german/greetings/basics.csv` — 20 greetings
- `data/languages/german/food/food.csv` — 20 food words

Both languages are Latin-script — no native column, directions 1 and 2 only (same as Spanish/Norsk).

---

## Import language dropdown locked to supported languages (2026-05-21)

Removed the free-text "New language..." option from the Import screen.
Language is now a fixed dropdown matching the 6 supported languages shown on the login page.
Topics remain flexible — "New topic..." free-text option is still available.

---

## Auto-import vocabulary on deploy (2026-05-21)

Vocabulary files are now imported automatically on every Railway deploy via the `release` command.
Only `vocabulary/` topic folders are kept in the repo — all other topic folders (greetings, food, verbs, etc.) removed.

- `scripts/bulk_import.py` — walks `DATA_DIR/<language>/<topic>/*.csv` and calls `import_vocab_file` for each file; fully idempotent (skips cards already in the database)
- `Procfile` — `release` command now runs: `alembic upgrade head && python scripts/seed_user.py && python scripts/bulk_import.py`
- Removed: `spanish/greetings/`, `spanish/food/`, `spanish/verbs/`, `french/greetings/`, `french/food/`, `german/greetings/`, `german/food/`, `japanese/n5/`, `mandarin/hsk1/`, `norsk/greetings/`, `norsk/basics/`

On a fresh Railway deploy the app comes pre-loaded with 6,000 vocabulary cards (1,000 per language) with no manual import needed.

---

## 1000-word vocabulary files for all 6 languages (2026-05-21)

Added `data/languages/<language>/vocabulary/top1000.csv` for all 6 supported languages,
each with exactly 1000 unique, deduplicated entries covering verbs, nouns, adjectives,
adverbs, numbers, question words, days, months, seasons, professions, and thematic vocabulary.

**Mandarin restructured** — `word` column now holds hanzi (characters) instead of pinyin,
and `native` holds the pinyin reading. This makes uniqueness reliable (characters are
unambiguous; pinyin tone marks were being stripped by `normalize_text()`, causing different
words to collide on the same idempotency key).

- `app/services/importer.py` — `compute_idempotency_key` now falls back to the raw
  lowercased word when `normalize_text()` strips all content (e.g. CJK characters),
  so each hanzi compound is treated as a distinct key
- `data/languages/spanish/vocabulary/top1000.csv` — 1000 entries
- `data/languages/french/vocabulary/top1000.csv` — 1000 entries
- `data/languages/german/vocabulary/top1000.csv` — 1000 entries (articles kept: `der/die/das Nomen`)
- `data/languages/japanese/vocabulary/top1000.csv` — 1000 entries (romaji word, kana/kanji native)
- `data/languages/mandarin/vocabulary/top1000.csv` — 1000 entries (hanzi word, pinyin native)
- `data/languages/norsk/vocabulary/top1000.csv` — 1000 entries

Import each via the UI: language → `vocabulary` as topic → upload `top1000.csv`.
Re-importing is safe — duplicates with existing topic files are skipped automatically.

---

## Demo login (2026-05-21)

Added a guest demo mode so casual visitors can explore the app without registering.

- `app/config.py` — added `DEMO_USERNAME` (default: `demo`) and `DEMO_PASSWORD` (default: `demo`)
- `scripts/seed_user.py` — now seeds both admin and demo users on every deploy
- Login page — "Try Demo" button auto-fills and submits demo credentials
- Divider line between Log in and Try Demo buttons

The demo user is created automatically on Railway deploy via the `release` command.
To customise the demo credentials, set `DEMO_USERNAME` and `DEMO_PASSWORD` in Railway variables.
