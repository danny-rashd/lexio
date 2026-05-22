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

## Phase 1 — Loading states `Done`

**Problem:** Every API call (loading decks, starting a quiz, importing) freezes the UI with no feedback. Feels broken on slow connections.

**Scope:**
- Spinner or skeleton overlay on Home while decks load
- Disabled + spinner state on all primary action buttons during API calls (Start Test, Start Big Test, Import, Log in)
- Progress screen skeleton while stats load

**Files:** `app/static/app.js`, `app/static/style.css`

---

## Phase 2 — Empty states `Done`

**Problem:** A new user lands on a blank home screen with only a text sentence as guidance. No clear next step.

**Scope:**
- Home with no decks: icon + headline + explanation + prominent "Import Vocabulary" CTA button
- Browse with no cards: icon + message
- Progress with no data: icon + "Start your first quiz to see stats"
- Weakest cards section on home: hide entirely if no study history rather than showing an empty table

**Files:** `app/static/app.js`, `app/static/style.css`, `app/static/index.html`

---

## Phase 3 — Human-readable error messages `Done`

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

## Phase 4 — Results forward-guidance `Done`

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

## Phase 5 — Quiz setup descriptions + inline keyboard affordances `Done`

**Problem:** Mode and direction options are labelled but not explained. A user who doesn't know what "Characters → Reading" means gets no guidance. Keyboard shortcuts exist but are hidden behind a `?` tooltip — not naturally discoverable mid-quiz.

**Scope:**

Quiz setup:
- Mode cards: replace toggle buttons with larger cards showing name + one-line description
  - Multiple Choice: "Pick the correct answer from 4 options"
  - True / False: "Decide if the pair shown is correct"
  - Typing: "Type the answer from memory"
  - Flashcard *(Phase 13)*: "Reveal the answer and grade yourself"
- Direction options: add a subtitle showing an example pair
  - Word → Meaning: e.g. "konnichiwa → hello"
  - Characters → Reading: e.g. "こんにちは → konnichiwa"
- MCQ disabled state: improve the warning message with a link to Import

Inline keyboard affordances (quiz screen):
- MCQ option buttons: small `1` / `2` / `3` / `4` key badge on the far left of each button
- True button: `T` key badge · False button: `F` key badge
- Hint button: `H` key badge beside the label
- Next → / See Results button: `Enter ↵` badge beside the text
- `?` tooltip in quiz topbar: simplified to only list non-visible shortcuts (`Esc` end quiz, `/` search in browse, `Esc` go back) — visible shortcuts no longer need listing since they are shown inline
- Key badges are hidden on touch devices (mobile) — keyboard hints are irrelevant without a physical keyboard

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 6 — Mobile layout `Done`

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

## Phase 7 — Import preview `Done`

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

## Phase 8 — Home hierarchy + word progress `Done`

**Problem:** The home screen gives equal visual weight to everything. Streak, decks, and weakest cards compete for attention. There is also no indication of how much of each deck or language has actually been studied.

**Scope:**
- Top section: streak number prominently displayed with a small calendar preview (last 7 days)
- Quick-start card: "Continue studying [last used language]" — one-click to open quiz setup for the most recently used deck
- Deck grid: move below the above
- **Per-topic progress:** each topic card shows "12 / 20 words seen" — cards with at least one `card_stats` entry vs total `card_count` for that deck
- **Per-language progress:** language group header shows "65% of words studied" — cards seen across all topics for that language vs total `language_card_count`
- Weakest cards preview: limit to 3 cards maximum; style as a compact horizontal strip, not a tall grid

**API:** `/api/progress/stats?deck_id=X` already returns `cards_seen` per deck — call it for each visible deck on home load (batched via `Promise.all`). No new endpoints needed.

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 9 — Language proficiency visualization `Done`

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

## Phase 10 — Anki deck import `Done`

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

## Phase 11 — Deck delete (topic-level hard delete) `Done`

**Problem:** There is no way to remove a deck or its cards from the UI. The existing API endpoint does a soft-delete only (marks cards inactive but keeps rows in the database).

**Scope:**

Backend:
- Update `DELETE /api/decks/{id}` to hard-delete: remove `card_stats` rows for each card, `quiz_answers` rows for each card, `import_batches` for the deck, all `cards` rows, and finally the `deck` row itself. Cascade in correct FK order to avoid constraint errors.
- `quiz_sessions` that referenced this deck become orphaned — set `deck_id = NULL` rather than deleting them (preserves historical score records).

Frontend:
- Home screen: add a Delete button on each topic card (alongside Browse / Quiz / Import). Triggers a confirm modal with deck name before proceeding.
- Browse screen: add a Delete Deck button in the page header. Same confirm flow.
- After deletion: navigate to Home and refresh the deck list.

**Files:** `app/routers/decks.py`, `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 12 — Deck export and `.lex` import `Done`

**Problem:** Vocabulary data is locked inside the app. Users cannot back up, share, or restore individual decks without re-importing raw CSV files.

**Background:** `.lex` is a custom Lexio format — a UTF-8 CSV file with metadata comment lines at the top. Because comment lines (`#`) are already skipped by the existing parser, `.lex` files are importable with zero parser changes. The metadata enables auto-detection of language and topic on import.

**`.lex` file format:**
```
# Lexio deck export
# language: spanish
# topic: greetings
# exported: 2026-05-21
# cards: 20
word,meaning,native
hola,hello,
adiós,goodbye,
```

**Scope:**

Backend:
- New endpoint `GET /api/decks/{id}/export` — returns a `.lex` file as a downloadable response (`Content-Disposition: attachment`)
- No new Alembic migration needed

Frontend:
- Home screen: Export button on each topic card
- Browse screen: Export button in page header
- Import screen: accept `.lex` files; parse the `# language:` and `# topic:` comment lines; pre-fill the language and topic dropdowns automatically before the user clicks Import

**Files:** `app/routers/decks.py`, `app/static/app.js`, `app/static/index.html`

---

## Phase 13 — Flashcard mode `Done`

**Problem:** The app has MCQ, True/False, and Typing — but no traditional flip-card mode. Users migrating from Anki or physical flashcards expect to see a word, mentally recall the answer, then reveal it and self-grade. This is also the foundation required for SRS (Phase 14).

**How it works:**
1. Show the word (and native script if available) — answer is hidden
2. User clicks **Reveal** (or presses Space/Enter) to flip
3. Answer is shown
4. User grades themselves: **Knew it** or **Didn't know**
5. Result recorded in `card_stats` as correct/incorrect; session advances to next card

**Scope:**

Frontend:
- New mode option "Flashcard" alongside MCQ / True/False / Typing in Test Setup
- Quiz screen: "Reveal" button replaces the answer input; on click, correct answer appears and grade buttons replace it
- Keyboard shortcuts: `Space` or `Enter` to reveal; `1` = Knew it, `2` = Didn't know
- Works with all 4 directions; native script shown for directions 3 and 4

Backend:
- No new endpoints needed — uses existing `POST /api/quiz/{session_id}/answer` with `user_answer: "knew"` or `"didn't know"`; server records `is_correct` accordingly
- Add `"flashcard"` to the `mode` CHECK constraint in `quiz_sessions` — requires a new Alembic migration

**Files:**
- `app/models/progress.py` — update `mode` CHECK constraint
- New Alembic migration
- `app/routers/quiz.py` — handle flashcard mode in `_build_question` and `_evaluate`
- `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 14 — SRS scheduling (SM-2) `Done`

**Problem:** The current app uses weakness weighting (show cards with lower correct rates more often) but is not true spaced repetition. True SRS schedules each card on a specific due date based on performance history and a forgetting curve, dramatically improving long-term retention efficiency.

**Background:** The SM-2 algorithm (used by Anki) assigns each card an `interval` (days until next review) and `ease_factor` (difficulty multiplier). After each review the values are updated based on the grade (Again / Hard / Good / Easy). Cards are shown when `due_date ≤ today`.

**This phase depends on Phase 13** (Flashcard mode) since SRS requires self-evaluation grades, not just correct/incorrect.

**Scope:**

Backend:
- Add columns to `card_stats`: `interval` (INTEGER, default 1), `ease_factor` (REAL, default 2.5), `due_date` (DATE, nullable) — new Alembic migration
- New service `app/services/srs.py` — implements SM-2: `next_review(grade, interval, ease_factor) -> (new_interval, new_ease_factor, due_date)`
- Grades mapped from flashcard: Again=0, Hard=1 (partial), Good=2, Easy=3 — or simplified to Again / Good for v1
- `upsert_card_stat` updated to call SRS calculation when mode is flashcard
- New endpoint `GET /api/quiz/due?deck_id=X&limit=20` — returns cards where `due_date ≤ today`, ordered by due date ascending. Cards never reviewed (null `due_date`) are treated as due immediately.

Frontend:
- New session scope: **Review** (alongside Test and Big Test) — shows only due cards, always uses Flashcard mode, no mode selection needed
- Home screen: due card count badge on each deck ("5 due") if any cards are due today
- Test Setup: "Review Due Cards (N)" shortcut button appears when cards are due for that deck

**Files:**
- `app/models/progress.py` — new columns on `card_stats`
- New Alembic migration
- New: `app/services/srs.py`
- `app/services/progress.py` — update `upsert_card_stat`
- `app/routers/quiz.py` — new due-cards endpoint, Review scope handling
- `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 15 — Essay evaluation (Claude Haiku) `Done`

**Problem:** Flashcards and quizzes test recognition and recall, but not productive writing ability. A learner can know 1000 words and still be unable to compose a coherent paragraph.

**How it works:**
1. User selects the language they're writing in
2. Types an essay (20–500 words, configurable via `ESSAY_MAX_WORDS`)
3. Submits → backend calls Claude Haiku with a structured evaluation prompt
4. Results displayed as scored categories with specific error callouts
5. Submission stored in DB so writing progress is trackable over time

**Scoring categories (weighted):**
| Category | Weight | Notes |
|---|---|---|
| Grammar | 30% | Verb conjugation, sentence structure, agreement |
| Diacritics | 20% | Missing accent = −2 pts, wrong accent = −4 pts; 100 for JP/ZH (no Latin diacritics) |
| Spelling | 20% | Incorrect word spelling |
| Fluency | 15% | Natural expression, vocabulary range |
| Punctuation | 15% | Correct use of commas, periods, etc. |

**Scope:**

Backend:
- `app/models/essay.py` — `EssaySubmission` table (language, text, word_count, overall_score, evaluation JSON, submitted_at)
- `app/services/essay_evaluator.py` — Claude Haiku API call with prompt caching on system prompt
- `app/routers/essay.py` — `POST /api/essay/submit`, `GET /api/essay/history`
- New Alembic migration

Frontend:
- **Essay** button added to nav
- New screen: language selector, textarea with live word count, Submit button
- Results view: overall score ring + category bars + error list per category
- History section: past submissions with score and date

**Config:** `ANTHROPIC_API_KEY` (required), `ESSAY_MAX_WORDS` (default 500)

**Files:** `app/models/essay.py`, migration, `app/services/essay_evaluator.py`, `app/routers/essay.py`, `app/schemas/essay.py`, `app/main.py`, `app/static/`

---

## Phase 16 — Immersion tracking journal `Done`

**Problem:** Language acquisition happens outside the app — watching shows, reading books, listening to podcasts. There's no way to log this time or see how it contributes to overall study effort.

**Scope:**

A log entry captures:
- Date
- Language
- Activity type (Reading / Listening / Watching / Speaking / Writing / Gaming / Other)
- Resource name (e.g. "Netflix — Money Heist S2", "Podcast — Coffee Break Spanish")
- Duration in minutes
- Optional personal notes / rating (1–5)

Dashboard shows:
- Total hours per language (all time + this week)
- Breakdown by activity type (bar chart)
- Combined streak: quiz days + immersion days
- Recent log entries (journal view)

Integration with Progress screen: immersion time shown alongside quiz stats.

**Files:** `app/models/immersion.py`, migration, `app/routers/immersion.py`, `app/static/`

---

## Phase 17 — Text-to-Speech (TTS) `Done`

**Problem:** Vocabulary cards show text only. Learners who are building listening comprehension or learning pronunciation have no audio feedback.

**How it works:** Browser's built-in Web Speech API (`speechSynthesis`) — zero cost, no API key, no backend changes. Language is mapped to a BCP-47 locale (`es-ES`, `fr-FR`, `de-DE`, `nb-NO`, `ja-JP`, `zh-CN`).

**Scope:**

Frontend only:
- `speak(text, language)` utility function — cancels any in-progress speech, then speaks the given text with the correct locale
- **Quiz screen:** 🔊 Speak button appears below the question word (hidden if browser has no TTS support). In flashcard mode the word is auto-spoken when the card appears; in other modes the button is available on demand.
- **Browse screen:** 🔊 button on every row — speaks the word in the deck's language

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 18 — Daily study goal + progress bar `Done`

**Problem:** There is no daily target, so sessions feel open-ended. A simple goal counter would give each session a clear finish line and a sense of accomplishment.

**Scope:**

Frontend only (localStorage):
- Default goal: 20 cards per day (configurable in a small settings popover on the Home screen)
- Top-of-home progress bar: "Today: 14 / 20 cards" — fills as quiz answers are submitted during the day
- Counter resets at midnight (compare `new Date().toDateString()` with stored date)
- Completion state: bar turns green and shows "Goal reached!" with a small celebration

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`

---

## Phase 19 — "Add to deck" from Journal `Done`

**Problem:** When logging an immersion session in the Journal, learners often encounter new vocabulary. Currently there is no way to capture those words without leaving the Journal and navigating to Import.

**Scope:**

Frontend only:
- Each Journal log entry gets a small "+ Add word" button
- Click opens a compact inline form: word / meaning / native (optional) — language pre-filled from the log entry's language
- On submit: `POST /api/cards` with the deck that matches the entry's language + a "journal" topic (create it if it doesn't exist)
- Success: a small "Added!" confirmation next to the button; form collapses

**Files:** `app/static/app.js`, `app/static/index.html`, `app/static/style.css`
**API:** existing `POST /api/cards` and `POST /api/decks` endpoints — no new endpoints needed

---

## Notes

**Phase ordering constraints:**
- Phase 7 (Import preview) should precede Phase 10 (Anki import) — Anki reuses the preview UI pattern
- Phase 13 (Flashcard mode) must precede Phase 14 (SRS) — SRS requires self-evaluation grades introduced in flashcard mode
- All other phases are independent and can be built in any order

**On SRS vs current behaviour:**
The current app is *weakness-weighted*, not SRS. It shows weaker cards more often based on correct rate, but has no scheduling algorithm, no intervals, and no due dates. Phase 14 adds true SM-2 scheduling. Until then, the app is useful for active study sessions but not optimal for long-term retention.

**Migrations:**
- Phase 11 (deck delete): no new columns, no migration needed
- Phase 12 (deck export): no new columns, no migration needed
- Phase 13 (flashcard mode): adds `"flashcard"` to `quiz_sessions.mode` CHECK constraint — migration required
- Phase 14 (SRS): adds `interval`, `ease_factor`, `due_date` to `card_stats` — migration required

**Each completed phase gets an entry in `docs/CHANGES.md` and its status updated here.**
