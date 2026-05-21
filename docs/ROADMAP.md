# Lexio — UX Improvement Roadmap

Post-launch improvement plan. Each phase ships independently.
When a phase is complete, log it in `docs/CHANGES.md` and mark status here as **Done**.

---

## Status legend

| Status | Meaning |
|---|---|
| Planned | Not started |
| In Progress | Being built |
| Done | Shipped |

---

## Phase 1 — Loading states `Planned`

**Problem:** Every API call (loading decks, starting a quiz, importing) freezes the UI with no feedback. Feels broken on slow connections.

**Scope:**
- Spinner or skeleton overlay on Home while decks load
- Disabled + spinner state on all primary action buttons during API calls (Start Test, Start Big Test, Import, Log in)
- Progress screen skeleton while stats load

**Files:** `app/static/app.js`, `app/static/style.css`

---

## Phase 2 — Empty states `Planned`

**Problem:** A new user lands on a blank home screen with only a text sentence as guidance. No clear next step.

**Scope:**
- Home with no decks: icon + headline + explanation + prominent "Import Vocabulary" CTA button
- Browse with no cards: icon + message
- Progress with no data: icon + "Start your first quiz to see stats"
- Weakest cards section on home: hide entirely if no study history rather than showing an empty table

**Files:** `app/static/app.js`, `app/static/style.css`, `app/static/index.html`

---

## Phase 3 — Human-readable error messages `Planned`

**Problem:** Raw API error strings surface directly to the user (e.g. `"No active cards available for this session"`). Internal language leaks into the UI.

**Scope:**
- Map known API `detail` strings to friendly, actionable messages
- Examples:
  - "No active cards available for this session" → "This deck doesn't have enough cards. Import more vocabulary first."
  - "Deck has no active cards" → same as above
  - "File too large. Maximum size is 5 MB." → keep as-is, already readable
  - Network failure → "Couldn't reach the server. Check your connection and try again."
- Centralise error mapping in one function rather than scattering across handlers

**Files:** `app/static/app.js`

---

## Phase 4 — Results forward-guidance `Planned`

**Problem:** After a quiz the user sees a score and a missed-cards table, then has to decide what to do next on their own.

**Scope:**
- Add contextual recommendation below the score based on result:
  - ≥ 80%: "Great session! Try Big Test to challenge yourself across all languages."
  - 50–79%: "Good progress. Retry the missed cards below to reinforce them."
  - < 50%: "Tough session — focus on [weakest direction] in [language]. Retry missed cards?"
- "Retry missed cards" button: starts a new Test session pre-filtered to the same deck and mode used, skipping the setup screen
- Show all answers (correct + incorrect), not only missed — collapsed by default, expandable

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 5 — Quiz setup descriptions `Planned`

**Problem:** Mode and direction options are labelled but not explained. A user who doesn't know what "Characters → Reading" means gets no guidance.

**Scope:**
- Mode cards: replace toggle buttons with larger cards showing name + one-line description
  - Multiple Choice: "Pick the correct answer from 4 options"
  - True / False: "Decide if the pair shown is correct"
  - Typing: "Type the answer from memory"
- Direction options: add a subtitle showing an example pair
  - Word → Meaning: e.g. "konnichiwa → hello"
  - Characters → Reading: e.g. "こんにちは → konnichiwa"
- MCQ disabled state: improve the warning message with a link to Import

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 6 — Mobile layout `Planned`

**Problem:** The nav gets crowded on small screens, the quiz topbar overflows, and the shortcuts tooltip goes offscreen on mobile.

**Scope:**
- Nav: collapse "Progress" and "Import" text labels on narrow screens; keep icons only or use a hamburger menu
- Quiz topbar: hide the `?` shortcuts button on mobile (shortcuts are keyboard-only, irrelevant on touch)
- Shortcuts tooltip: position above the button on small screens to avoid offscreen overflow
- Deck grid: ensure single-column layout on very narrow screens
- Import form: full-width dropdowns and inputs on mobile
- Browse table: horizontal scroll with sticky first column (word) on narrow screens

**Files:** `app/static/style.css`, `app/static/index.html`

---

## Phase 7 — Import preview `Planned`

**Problem:** File upload is fire-and-forget. No preview before committing, no recovery if the wrong file is selected.

**Scope:**
- After file is selected (before clicking Import), show a preview card:
  - Detected format (CSV / TSV)
  - Number of rows found
  - First 3 rows as a table preview (word / meaning / native)
  - Warning if header row is missing or format looks wrong
- The Import button only appears after the preview is accepted
- Success state persists until user navigates away (not lost on next action)

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 8 — Home hierarchy `Planned`

**Problem:** The home screen gives equal visual weight to everything. Streak, decks, and weakest cards compete for attention.

**Scope:**
- Top section: streak number prominently displayed with a small calendar preview (last 7 days)
- Quick-start card: "Continue studying [last used language]" — one-click to open quiz setup for the most recently used deck
- Deck grid: move below the above; show language-level card count prominently
- Weakest cards preview: limit to 3 cards maximum; style as a compact horizontal strip, not a tall grid

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 9 — Language proficiency visualization `Planned`

**Problem:** The Progress screen shows raw numbers and a table but no at-a-glance picture of which languages you are strongest/weakest in.

**Scope:**
- Add a visual proficiency section to the existing Progress screen (no new page needed)
- Per-language bar showing overall correct rate, colour-coded by language pill colour
- Per-direction breakdown within each language (4 bars: Word→Meaning, Meaning→Word, Characters→Meaning, Characters→Reading) — collapsed by default, expandable per language
- Summary badge on each language: Beginner / Developing / Proficient / Fluent based on correct rate thresholds (< 40% / 40–65% / 65–85% / > 85%)
- Implemented in vanilla JS using SVG — no charting library

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`
**API:** existing `/api/progress/dashboard` and `/api/progress/weakest` — no new endpoints needed

---

## Phase 10 — Anki deck import `Planned`

**Problem:** Creating vocabulary CSV files by hand is time-consuming. Anki is the most widely used flashcard app and has thousands of shared decks covering all supported languages.

**Background:** `.apkg` files are ZIP archives containing a SQLite database (`collection.anki2`). The `notes` table stores card content with fields separated by `\x1f`. Note types define field names (e.g. "Front", "Back", "Expression", "Reading") which vary per deck — a mapping step is required.

**Scope:**

Backend:
- `app/services/anki_parser.py` — unzip `.apkg`, open the SQLite, read note types and sample rows; no extra dependencies (`zipfile` + `sqlite3` are stdlib)
- New endpoint `POST /api/import/anki/preview` — accepts `.apkg` upload, returns available note types, field names, and 5 sample rows per type
- Update `POST /api/import` or add `POST /api/import/anki/confirm` — accepts the field mapping chosen by the user and performs the actual import using the existing `import_vocab_file` service

Frontend (Import screen):
- File picker now accepts `.apkg` in addition to `.csv` / `.tsv`
- When an `.apkg` is selected: call the preview endpoint, show a mapping UI
  - Dropdown per target field: which Anki field → `word`, which → `meaning`, which → `native` (optional)
  - Preview table showing 5 rows with the chosen mapping applied
  - Language + topic selectors remain the same
- On confirm: call the import endpoint with the mapping; show the standard inserted/skipped counts

**Files:**
- New: `app/services/anki_parser.py`
- New: `app/routers/anki.py` (or extend `app/routers/import_.py`)
- `app/main.py` — include new router if separate
- `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Notes

- Phases are independent — any can be built out of order except Phase 7 (Import preview) should precede Phase 10 (Anki import) since Anki reuses the preview UI pattern.
- Each completed phase gets an entry in `docs/CHANGES.md`.
- Backend changes (Phase 10) require new Alembic migrations only if new tables are added — Phase 10 reuses existing `Card` and `Deck` models, so no migration is needed.
