# Post-launch changes

## Phase 15 — Essay evaluation (2026-05-22)

Write an essay in any of your study languages and get instant AI feedback via Claude Haiku.

**Scoring breakdown (weighted):** Grammar 30% · Diacritics 20% · Spelling 20% · Fluency 15% · Punctuation 15%

**Flow:** Write essay (20–500 words) → select language → Evaluate → see score ring + per-category bars + error list with corrections → optionally view history of past submissions.

**Diacritics scoring:** missing accent (e→é) −2 pts, wrong accent (è→é) −4 pts. Japanese and Mandarin automatically score 100 on diacritics.

**Backend:** `app/models/essay.py` (`EssaySubmission` table), `app/services/essay_evaluator.py` (Claude Haiku with prompt caching on system message), `app/routers/essay.py` (`POST /api/essay/submit`, `GET /api/essay/history`, `GET /api/essay/{id}`). New Alembic migration.

**Config required:** `ANTHROPIC_API_KEY` must be set in Railway variables. `ESSAY_MAX_WORDS` (default 500), `ESSAY_MIN_WORDS` (default 20).

**Frontend:** Essay nav button; new screen with language selector, textarea with live word count, score ring, category bars, error cards per category, history table.

**Files:** `app/models/essay.py`, migration, `app/services/essay_evaluator.py`, `app/routers/essay.py`, `app/schemas/essay.py`, `app/main.py`, `requirements.txt`, `app/config.py`, `app/static/`

---

## Phase 14 — SRS scheduling SM-2 (2026-05-21)

Spaced repetition scheduling using the SM-2 algorithm. Flashcard grades now control when each card appears next.

**SM-2 grade → quality mapping:** again=0, hard=3, good=4, easy=5. Quality < 3 resets the card.

**New columns on `card_stats`:** `srs_interval` (days), `srs_ease_factor` (default 2.5), `srs_due_date` (date), `srs_repetitions` (consecutive correct count).

**`app/services/srs.py`** — SM-2 implementation:
- `next_review(grade, interval, ease_factor, repetitions)` → returns `(new_interval, new_ef, due_date, new_reps)`
- `count_due(db, deck_id)` → count of cards with `srs_due_date ≤ today`
- `select_due_cards(db, deck_id, count)` → ordered list of due cards for Review sessions

**`upsert_card_stat`** — accepts optional `grade` parameter. When grade is provided (flashcard mode), SM-2 updates `srs_*` fields. MCQ/Typing leave SRS fields unchanged.

**Review scope** — new `scope='review'` in `POST /api/quiz/start`. Always uses Flashcard mode + `all_available` direction. Selects only cards where `srs_due_date ≤ today`. Returns 400 if no cards are due.

**Home screen** — topic cards show a blue **Review N** button when N cards are due. Clicking it starts a Review session immediately without going through Test Setup.

**`/api/progress/stats`** — now returns `due_count` per deck.

**Files:** `app/models/progress.py`, new Alembic migration, `app/services/srs.py`, `app/services/progress.py`, `app/routers/quiz.py`, `app/routers/progress.py`, `app/static/app.js`, `app/static/style.css`

---

## Phase 13 — Flashcard mode (2026-05-21)

A fourth quiz mode: see the prompt, mentally recall the answer, reveal it, then self-grade.

**Flow:**
1. Prompt shown (word / native script depending on direction) — answer hidden
2. **Reveal** button (or `Space`/`Enter`) flips to show the correct answer
3. **Knew it** (key `1`) or **Didn't know** (key `2`) grade buttons appear
4. Feedback shown briefly (✓ "Knew it!" / ✗ "Didn't know") — no redundant answer display since user already saw it
5. 3-second countdown auto-advances as normal

**Backend:**
- `QuizSession.mode` CHECK constraint updated: adds `'flashcard'`
- New Alembic migration (`add flashcard mode`) using `batch_alter_table` for SQLite + PostgreSQL compatibility
- `_VALID_MODES` in quiz router updated
- `_build_question`: flashcard reuses `build_typing_question` structure with `type` overridden to `"flashcard"`
- `_evaluate`: `user_answer == "knew"` → `is_correct = True`; `"didn't know"` → False

**Frontend:**
- `MODE_INFO` extended with Flashcard entry (appears in Test Setup mode cards)
- New `renderFlashcard()`, `revealFlashcard()` functions
- Grade buttons styled green (Knew it) and red (Didn't know)
- Keyboard shortcuts: `Space`/`Enter` to reveal; `1` Knew it, `2` Didn't know
- `?` tooltip updated to list flashcard shortcuts
- `showFeedback` skips the "Answer:" line in flashcard mode (answer was already revealed)

**Files:** `app/models/progress.py`, new Alembic migration, `app/routers/quiz.py`, `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 12 — Deck export and `.lex` import (2026-05-21)

**`.lex` format** — UTF-8 CSV with metadata comment lines at the top:
```
# Lexio deck export
# language: spanish
# topic: vocabulary
# exported: 2026-05-21
# cards: 1000
word,meaning,native
hola,hello,
```

**Export:**
- `GET /api/decks/{id}/export` — returns the `.lex` file as a download. Uses Python's `csv` module for proper quoting of fields containing commas.
- **Home topic card**: new **Export** button (ghost, alongside Test / Browse / Delete)
- **Browse screen header**: **Export .lex** button next to Delete Deck
- Filename: `{language}_{topic}.lex`

**Import:**
- File picker now accepts `.lex` in addition to `.csv`, `.tsv`, `.apkg`
- When a `.lex` file is selected: `_handleLexFile()` reads metadata comments, auto-fills the language dropdown and topic dropdown/input before showing the preview
- If the topic already exists in the database, it's selected; if not, "New topic" text input is pre-filled with the metadata value
- Existing CSV parser already skips `#` comment lines — zero parser changes needed

**Files:** `app/routers/decks.py`, `app/static/app.js`, `app/static/index.html`

---

## Phase 11 — Deck delete (2026-05-21)

Topic-level hard delete — permanently removes a deck and all associated data.

**Cascade order (FK-safe):**
1. `card_stats` rows for each card in the deck
2. `quiz_answers` rows for each card in the deck
3. `quiz_sessions.deck_id` set to NULL (session history preserved, FK cleared)
4. `import_batches` for the deck
5. All `cards` rows for the deck
6. The `deck` row itself

**Frontend:**
- **Home topic card**: new red **Delete** button alongside Test / Browse. Confirm modal states the card count and warns the action cannot be undone.
- **Browse screen header**: **Delete Deck** button in the page header — same confirm flow.
- After deletion: navigates to Home and refreshes deck list. Clears `App.lastUsedDeck` if it was the deleted deck.

**Files:** `app/routers/decks.py`, `app/static/app.js`, `app/static/index.html`

---

## Phase 10 — Anki deck import (2026-05-21)

Import vocabulary directly from Anki `.apkg` decks without any manual CSV creation.

**How the flow works:**
1. Select or drop a `.apkg` file → preview endpoint called immediately → returns note types + field names + 5 sample rows
2. Mapping UI appears: select which Anki note type to import, then map each Anki field → Word / Meaning / Native
3. Live preview table updates as you change the mapping (client-side, no extra API call)
4. Choose language + topic as normal, click Import → confirm endpoint extracts and inserts cards

**Backend:**
- `app/services/anki_parser.py` — unzips `.apkg` (ZIP archive), opens embedded SQLite, reads note types from both Anki 2.1.28+ schema (`notetypes`/`fields` tables) and legacy schema (`models` JSON in `col` table). Strips HTML tags from field values.
- `app/services/importer.py` — refactored: insertion logic extracted to `import_rows()` helper, called by both `import_vocab_file()` and Anki endpoint
- `POST /api/import/anki/preview` — accepts `.apkg`, returns note type metadata
- `POST /api/import/anki/confirm` — accepts `.apkg` + field mapping query params, calls `import_anki_deck()`

**Frontend:**
- File picker now accepts `.csv`, `.tsv`, `.apkg`
- `.apkg` detection routes to Anki flow; CSV/TSV uses existing flow unchanged
- Sensible field defaults: field 0 → word, field 1 → meaning, field 2 → native (if ≥3 fields)
- `App.ankiData` stores note types and selected note type index across mapping interactions

**Files:** `app/services/anki_parser.py` (new), `app/services/importer.py`, `app/routers/import_.py`, `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 9 — Language proficiency visualization (2026-05-21)

Added a **Language Proficiency** section to the Progress screen, replacing the old simple stat blocks.

- Per-language card shows: language pill + name + proficiency badge + overall progress bar coloured by language pill colour
- **Proficiency badge** thresholds: Beginner (< 40%) · Developing (40–65%) · Proficient (65–85%) · Fluent (> 85%)
- Click any language card → expands to show per-direction breakdown (Word→Meaning, Meaning→Word, Characters→Meaning, Characters→Reading) with individual progress bars
- Collapsed by default — clean overview, details on demand
- CSS transition animates bars on render; `▶` indicator rotates 90° when expanded

**Backend:** `dashboard()` in `app/routers/progress.py` now includes `directions` field per language — per-direction `seen`, `correct`, `rate` aggregated from `card_stats`.

**Files:** `app/routers/progress.py`, `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 8 — Home hierarchy + word progress (2026-05-21)

**Streak strip:** compact card at the top showing current streak number + 7-day mini calendar squares. Hidden if no study history yet.

**Quick-start card:** "Continue studying [language]" with topic name, words-seen count, and a one-click Start button. Appears after the first quiz session. `lastUsedDeck` stored in `sessionStorage` so it persists across page refreshes.

**Per-topic progress:** each topic card now shows:
- Mini progress bar (accent colour, animates on render)
- "150 / 1000 seen" label below the bar
- `cards_seen` fetched from `/api/progress/stats?deck_id=X` — one call per deck, batched with `Promise.all`

**Per-language progress:** language group header now shows "65% studied" on the right — cards seen across all topics for that language divided by total cards.

**Weakest cards:** limited to 3 cards, displayed as a horizontal scrollable strip instead of a grid.

**`App.lastUsedDeck`** — stored when a Test quiz starts; restored from `sessionStorage` on load.

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 7 — Import preview (2026-05-21)

Client-side file parsing shows a preview card before the user commits to importing.

- `parseImportPreview(file)` — reads the file with `FileReader`, strips BOM, normalises line endings, handles outer-quoted rows (the `"hola,hello"` format), returns `{ format, totalRows, previewRows, warning }`
- Preview card shows: CSV/TSV format badge, detected row count, first 3 rows as a word/meaning/native table
- Warning shown if header row is missing or wrong (e.g. `"word,meaning,native"` not found)
- Import button starts **disabled**; enabled only after a valid file is loaded with a detected preview
- Empty files and unreadable files show an error immediately and keep Import disabled
- `showImport()` resets the preview and re-disables Import on every open

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 6 — Mobile layout (2026-05-21)

- **Nav (<600px):** wraps to two rows gracefully; `height: auto` instead of fixed 54px
- **Nav (<420px):** button labels abbreviated via `data-short` + CSS `::after content: attr()` — "Progress" → "Stats", "Import" → "+", "Log out" → "Out". Font-size trick keeps the HTML clean
- **Quiz topbar:** gap reduced on narrow screens so progress bar stays wide
- **Browse table:** first column sticky on horizontal scroll (`position: sticky; left: 0`) so the word is always visible while scrolling meanings/native/delete
- **MCQ grid:** single column below 500px (was 2-column)
- **T/F row:** single column below 500px
- **Typing input:** stacks vertically below 500px
- **Direction grid:** buttons wrap tighter at min-width 110px
- **`?` shortcuts button:** already hidden on touch devices via `@media (hover: none)` from Phase 5

**Files:** `app/static/style.css`, `app/static/index.html`

---

## UX Phase 5 — Quiz setup descriptions + inline keyboard affordances (2026-05-21)

**Quiz setup:**
- Mode selector replaced with description cards — each mode shows a one-line explanation ("Pick the correct answer from 4 options" etc.)
- Direction buttons now show an example pair below the label ("café → coffee", "こんにちは → konnichiwa")
- `checkMcqAvailability` updated to target new `.mode-card` class

**Inline keyboard affordances:**
- MCQ option buttons: `1`/`2`/`3`/`4` key badge on far left; option value stored in `data-value` for reliable correct-answer comparison
- True/False buttons: `T` / `F` key badge on each button
- Hint button: `H` key badge beside label
- Next → / See Results button: `↵` badge beside text (set dynamically in `showFeedback`)
- `?` tooltip simplified to non-visible shortcuts only (Esc, /, back)
- Key badges hidden on touch devices via `@media (hover: none)`

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 4 — Results forward-guidance (2026-05-21)

- **Contextual recommendation** shown below the score ring based on result percentage:
  - ≥ 80%: praise + suggest Big Test (or just praise for Big Test sessions)
  - 50–79%: encouragement + Retry Missed suggestion if there are missed cards
  - < 50%: focused improvement message
- **Retry Missed button** — visible for Test scope only (when a specific deck was used and there are missed cards). Starts a new quiz immediately with same deck/mode/direction, `card_count = missed count`. Big Test sessions hide this button since weakness weighting already handles it.
- **Show all answers** — collapsible section below missed cards showing every answer (correct + incorrect) with ✓/✗ icon. Collapsed by default.
- `initQuizState()` now accepts a `deckId` parameter so Retry Missed knows which deck to use.

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## UX Phase 3 — Human-readable error messages (2026-05-21)

- `friendlyError(detail)` — centralised mapping function; translates known API error strings to plain English. Falls back to the raw `detail` string for unmapped errors
- `_NETWORK_MSG` — shown when `detail` is null (network failure, no server response)
- `api()` and `apiUpload()` — wrapped with `try/catch`; return a fake `{ ok: false }` object on network failure so all existing error checks still work without throwing unhandled rejections
- All five raw error display sites updated to use `friendlyError()`

Mapped errors include: no active cards, deck/card not found, session expired, invalid credentials, file type validation. File-size error kept as-is (already readable).

**Files:** `app/static/app.js`

---

## UX Phase 2 — Empty states (2026-05-21)

Replaced plain text fallbacks with structured empty states (icon + headline + sub-text + CTA).

- **Home — no decks:** book icon, "No decks yet", explanation, "Import Vocabulary" button that opens the import screen directly
- **Browse — no cards:** document icon, "No cards in this deck", explanation. Separate message ("No cards match your search") when the search filter returns zero results — does not show the full empty state for a filter result
- **Progress — no data:** bar chart icon, "No study data yet", "Complete your first quiz…", "Go to Home" button. Progress screen exits early and hides all stat sections when `total_days === 0`
- **Weakest cards on Home:** already hidden when no data — confirmed correct, no change needed

**Files:** `app/static/app.js`, `app/static/style.css`, `app/static/index.html`

---

## UX Phase 1 — Loading states (2026-05-21)

- Button spinner (`btn-loading` class) on Login, Start Test, Start Big Test, Import — button text hides and a CSS-only rotating ring appears during the API call; re-enabled on failure
- Deck grid skeleton on Home — shimmer placeholder cards appear instantly while decks are fetching
- Progress screen skeleton — streak card and weakest-cards table show shimmer rows while stats load
- `setLoading(btn, loading)` helper centralises button state management
- `_deckSkeletonHtml()` and `_progressSkeletonHtml()` generate the shimmer markup

**Files:** `app/static/app.js`, `app/static/style.css`

---

## In-app modals, audio feedback, smart typing (2026-05-21)

### In-app modals
Replaced all browser `alert()` and `confirm()` dialogs with a styled in-app modal overlay.
The modal matches the existing dark/light theme and animates in with a subtle scale-in effect.
Destructive confirms (End Quiz, Delete Card) use a red confirm button.

- `app/static/index.html` — modal overlay HTML added
- `app/static/style.css` — modal styles + `@keyframes modal-in` animation
- `app/static/app.js` — `showAlert()` and `showConfirm()` (Promise-based); all `alert()`/`confirm()` replaced

### Audio feedback
Short synthesized sounds on every quiz answer using the Web Audio API — no audio files needed.
Correct: ascending two-note chime (C5 → E5). Wrong: brief low sawtooth tone (E4).

- `app/static/app.js` — `playSound(correct)` called inside `showFeedback()`

### Smart typing submit
Typing mode now detects matches as you type instead of always requiring a button click.

- **Exact match** (correct diacritics, case-insensitive) → auto-submits immediately, no remark
- **Normalised match** (wrong/missing diacritics) → submit button required; feedback shows *"Correct — proper spelling: día"*
- **No match** → submit button required; shows incorrect + correct answer

- `app/static/app.js` — `stripDiacritics()` helper; `input` event listener on typing field; updated submit handler; `handleAnswer(diacriticsRemark)` parameter; updated `showFeedback()`

---

## French and German pill colours updated (2026-05-21)

Previous colours clashed with existing language pills (FR cobalt overlapped JA indigo; DE amber overlapped ZH salmon).

- FR: `#0055A4` → `#7C3AED` (violet — unique hue, no overlap with any other language)
- DE: `#E67700` → `#991B1B` (dark maroon — clearly distinct from ES bright red and ZH salmon)

Final 6-pill palette: red (ES) · salmon (ZH) · indigo (JA) · teal (NO) · violet (FR) · maroon (DE)

---

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
