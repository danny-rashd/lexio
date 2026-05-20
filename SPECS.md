# SPECS.md — Lexio
> Feed this file to Claude Code to scaffold the full project.

---

## Overview

Lexio is a personal language flashcard web application for studying Spanish,
Mandarin, Japanese, and Norsk. It supports:
- Vocabulary organized by **language → topic** (nested folders)
- Three quiz modes: **multiple-choice, true/false, typing**
- **Four quiz directions** for Japanese/Mandarin (see Direction table); Spanish/Norsk use directions 1–2 only
- **Diacritics-insensitive** answer matching on all languages
- Per-card progress tracking (seen count, correct rate, weakness score)
- **Test mode**: one language + one topic folder per session
- **Big Test mode**: all languages combined, directions 1–2 only (for uniformity),
  weighted toward weakest cards, with selectable question count (10 / 20 / 50 / 100)
  — language pill badge on every card so you always know which language you're seeing
- Progress dashboard: per-card stats, weakest cards, daily streak
- Dark / light mode (defaults to system preference via `prefers-color-scheme`)

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend | Python + FastAPI | Async, typed, auto-docs |
| ORM / DB | SQLAlchemy 2.x + SQLite (dev) / PostgreSQL (prod) | Portable; swap via env var |
| Migrations | Alembic | Schema versioning |
| Frontend | Vanilla JS + HTML/CSS (no framework) | Zero build tooling |
| File parsing | Python `csv` stdlib | No extra deps |
| Testing | pytest + pytest-asyncio | Per project rules |
| Config | `python-dotenv` + pydantic-settings | 12-factor env vars |
| Auth | `python-jose` + `passlib[bcrypt]` | JWT tokens + password hashing |
| Text norm | Python `unicodedata` stdlib | Diacritics stripping — no extra deps |

> **Claude Code note:** Do not import UI frameworks into business logic or
> service layer files. No framework imports outside `app/static/`.

### Key utility files
- `app/utils/text.py` — `normalize_text`, `normalize_deck_label`
- `app/utils/hint.py` — `generate_letter_mask`, `next_reveal`

---

## Language Handling

| Language | Script stored as `word` | `native` field | Typing input |
|---|---|---|---|
| Spanish | Spanish word (e.g. `café`) | empty | diacritics-insensitive Latin |
| Norsk | Norsk word (e.g. `kjærlighet`) | empty | diacritics-insensitive Latin |
| Japanese | Romaji (e.g. `konnichiwa`) | Kana/Kanji (e.g. `こんにちは`) | romaji, diacritics-insensitive |
| Mandarin | Pinyin (e.g. `ni hao`) | Characters (e.g. `你好`) | pinyin, tone-marks insensitive |

**Diacritics-insensitive matching** applies to both the `word` and `meaning`
sides. Implementation: `unicodedata.normalize('NFKD', s).encode('ascii',
'ignore').decode().lower().strip()` — no external library needed.

---

## Input File Format

Files live in `data/languages/<language>/<topic>/`. Any `.csv` or `.tsv`
file in those folders is a valid import source.

### CSV format
```csv
word,meaning,native
hola,hello,
gracias,thank you,
café,coffee,
konnichiwa,hello,こんにちは
ni hao,hello,你好
god dag,good day,
```

### Rules
- Header row is always `word,meaning,native` — skip on parse
- `native` column is optional per row — blank is fine for Latin-script languages
- Delimiter auto-detected: comma → CSV, tab → TSV
- Encoding: UTF-8 required (CJK, diacritics)
- Empty rows and rows missing `meaning` are skipped with a warning
- Lines starting with `#` are comments — skip them
- `word` is normalized (diacritics stripped, lowercased) for dedup key only;
  stored as-is for display

### Folder structure
```
data/languages/
├── spanish/
│   ├── greetings/
│   │   └── basics.csv
│   ├── food/
│   │   └── food.csv
│   └── verbs/
│       └── present_tense.csv
├── mandarin/
│   └── hsk1/
│       └── vocab.csv
├── japanese/
│   └── n5/
│       └── hiragana.csv
└── norsk/
    └── greetings/
        └── basics.csv
```

---

## Database Schema

### Design principles
- **Idempotency on import**: `sha256(language:topic:word_normalized)` as dedup key
- **Audit trail**: `ImportBatch` records every file ingestion
- **Normalized**: language + topic → deck → cards (3-level hierarchy)
- **Soft deletes**: `is_active` flag preserves quiz history
- **Per-card stats**: separate `CardStat` table updated after every answer
- **Streak tracking**: `StudyLog` table records one row per calendar day studied

```sql
-- User (single-user for now; extensible)
CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deck = one language + one topic folder
CREATE TABLE decks (
    id          INTEGER PRIMARY KEY,
    language    TEXT NOT NULL,
    topic       TEXT NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(language, topic)
);
CREATE INDEX idx_decks_language ON decks(language);

-- Card = one vocabulary entry
CREATE TABLE cards (
    id              INTEGER PRIMARY KEY,
    deck_id         INTEGER NOT NULL REFERENCES decks(id),
    word            TEXT NOT NULL,
    meaning         TEXT NOT NULL,
    native          TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cards_deck ON cards(deck_id);
CREATE INDEX idx_cards_key  ON cards(idempotency_key);

-- CardStat = per-card, per-direction progress (upserted after every answer)
-- Up to 4 rows per card (one per direction attempted)
CREATE TABLE card_stats (
    id              INTEGER PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id),
    direction       TEXT NOT NULL CHECK(direction IN (
                      'word_to_meaning','meaning_to_word',
                      'native_to_meaning','native_to_word')),
    times_seen      INTEGER DEFAULT 0,
    times_correct   INTEGER DEFAULT 0,
    last_seen_at    TIMESTAMP,
    UNIQUE(card_id, direction)          -- one row per card+direction pair
);
CREATE INDEX idx_card_stats_card ON card_stats(card_id);

-- ImportBatch = one file-ingest event
CREATE TABLE import_batches (
    id              INTEGER PRIMARY KEY,
    deck_id         INTEGER NOT NULL REFERENCES decks(id),
    source_file     TEXT NOT NULL,
    rows_parsed     INTEGER,
    rows_inserted   INTEGER,
    rows_skipped    INTEGER,
    imported_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- QuizSession = one test sitting
CREATE TABLE quiz_sessions (
    id          INTEGER PRIMARY KEY,
    mode        TEXT NOT NULL CHECK(mode IN ('mcq', 'true_false', 'typing')),
    scope       TEXT NOT NULL CHECK(scope IN ('test', 'big_test')),
    deck_id     INTEGER REFERENCES decks(id),
    direction   TEXT NOT NULL CHECK(direction IN ('1_only', '2_only', '3_only', '4_only', '1_and_2', 'all_available', 'random')),
    total       INTEGER NOT NULL,
    correct     INTEGER DEFAULT 0,
    started_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP
);

-- QuizAnswer = one question attempt
CREATE TABLE quiz_answers (
    id              INTEGER PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES quiz_sessions(id),
    card_id         INTEGER NOT NULL REFERENCES cards(id),
    direction       TEXT NOT NULL CHECK(direction IN ('word_to_meaning', 'meaning_to_word', 'native_to_meaning', 'native_to_word')),
    user_answer     TEXT,
    correct_answer  TEXT NOT NULL,
    is_correct      BOOLEAN NOT NULL,
    answered_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- StudyLog = one row per calendar day studied
CREATE TABLE study_logs (
    id          INTEGER PRIMARY KEY,
    study_date  DATE NOT NULL UNIQUE,
    sessions    INTEGER DEFAULT 1,
    cards_seen  INTEGER DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

> **Data engineering note:** `weakness_score` is intentionally not stored as
> a column — it's a derived value (`1 - correct/seen`) computed at query time
> to avoid stale data. Stats are tracked **per card per direction**, so a card
> can have up to 4 weakness scores — one per direction attempted.
>
> The Big Test query aggregates across directions for overall card weakness,
> then the engine additionally weights toward the weakest `(card, direction)`
> combination within that card:
>
> ```sql
> -- Overall card weakness (for card selection in Big Test)
> SELECT
>     card_id,
>     SUM(times_seen)    AS total_seen,
>     SUM(times_correct) AS total_correct,
>     1.0 - SUM(times_correct) / NULLIF(SUM(times_seen), 0) AS weakness_score
> FROM card_stats
> GROUP BY card_id
> ORDER BY weakness_score DESC NULLS LAST;
>
> -- Per-direction weakness (for targeting within a session)
> SELECT card_id, direction,
>     1.0 - times_correct / NULLIF(times_seen, 0) AS dir_weakness
> FROM card_stats
> ORDER BY dir_weakness DESC NULLS LAST;
> ```
>
> Cards never seen in a direction rank highest (NULL → weakness = 1.0).
> This means Big Test will preferentially show `paisaje` in Direction 2
> if you consistently get Direction 1 right but Direction 2 wrong.

---

## API Endpoints

### Auth
| Method | Path | Protected | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Username + password → JWT |
| GET | `/api/auth/me` | Yes | Current user info |

> All endpoints below require `Authorization: Bearer <token>`.

### Decks
| Method | Path | Description |
|---|---|---|
| GET | `/api/decks` | List all decks grouped by language |
| GET | `/api/decks/{id}` | Deck detail + card count |
| DELETE | `/api/decks/{id}` | Soft-delete all cards in deck |

### Cards
| Method | Path | Description |
|---|---|---|
| GET | `/api/cards?deck_id=1&page=1&size=50` | Paginated card list |
| POST | `/api/cards` | Add a single card |
| DELETE | `/api/cards/{id}` | Soft-delete |

### Import
| Method | Path | Description |
|---|---|---|
| POST | `/api/import` | Upload CSV/TSV; params: `language`, `topic` |
| GET | `/api/import/batches?deck_id=1` | Past import batches |

> `POST /api/import` checks file size before parsing. If the upload exceeds
> `MAX_UPLOAD_SIZE_MB`, return `413 Request Entity Too Large` with body:
> `{"detail": "File too large. Maximum size is 5 MB."}`. This check happens
> in the router before the file is passed to the service layer.

### Quiz
| Method | Path | Description |
|---|---|---|
| POST | `/api/quiz/start` | Start session → `session_id` + first question |
| POST | `/api/quiz/{session_id}/answer` | Submit answer → result + next question |
| GET | `/api/quiz/{session_id}/result` | Final score + per-card breakdown |

### Progress
| Method | Path | Description |
|---|---|---|
| GET | `/api/progress/weakest?limit=20` | Weakest cards across all decks |
| GET | `/api/progress/stats?deck_id=1` | Per-deck correct rate summary |
| GET | `/api/progress/streak` | Current streak + total days studied |
| GET | `/api/progress/dashboard` | Aggregated view for dashboard screen |

---

## Quiz Engine — Question Generation

### Session start parameters

Test mode:
```json
{
  "scope": "test",
  "deck_id": 1,
  "mode": "mcq",
  "direction": "1_and_2",
  "card_count": 20
}
```

Big Test mode:
```json
{
  "scope": "big_test",
  "deck_id": null,
  "mode": "mcq",
  "direction": "1_and_2",
  "card_count": 20
}
```

`direction` options for Test: `1_only | 2_only | 3_only | 4_only | 1_and_2 | all_available | random`
`direction` for Big Test: always `1_and_2` — locked, not user-selectable
`card_count` options for Big Test: `10 | 20 | 50 | 100`

### Card selection — Test mode
Pull `card_count` active cards from the specified deck, shuffled randomly.

### Card selection — Big Test mode
Pull from all active cards across all decks, weighted toward weakest.
Uses aggregated weakness across all directions for card selection, then
within the session picks the weakest direction for each selected card:

```sql
-- Step 1: select weakest cards (aggregated across directions)
SELECT c.*,
    1.0 - SUM(cs.times_correct) / NULLIF(SUM(cs.times_seen), 0) AS weakness_score
FROM cards c
LEFT JOIN card_stats cs ON cs.card_id = c.id
WHERE c.is_active = TRUE
GROUP BY c.id
ORDER BY weakness_score DESC NULLS LAST,
         RANDOM()
LIMIT :card_count;

-- Step 2: for each selected card, pick the weakest available direction
-- (handled in Python after card selection, not in SQL)
-- pick_direction() checks card_stats for that card and returns the
-- direction with the highest dir_weakness, falling back to random if tied
```

### Directions

| # | Label | Show | Answer | Languages |
|---|---|---|---|---|
| 1 | `word_to_meaning` | `word` (+ `native` display) | `meaning` | All |
| 2 | `meaning_to_word` | `meaning` | `word` | All |
| 3 | `native_to_meaning` | `native` (characters) | `meaning` | JA, ZH only |
| 4 | `native_to_word` | `native` (characters) | `word` (romaji/pinyin) | JA, ZH only |

**Rules:**
- Directions 3 and 4 are only available when the card has a non-empty `native` field
- Cards missing `native` silently fall back to directions 1 and 2 only
- Spanish and Norsk cards always use directions 1 and 2 only
- **Big Test** is locked to directions 1 and 2 regardless of language — for
  uniformity when mixing all languages in one session
- In Test mode the user picks a direction preference:
  `1_only | 2_only | 3_only | 4_only | 1_and_2 | all_available | random`
- `random` picks from the directions available for that specific card

### Multiple Choice (MCQ)
- 1 correct card + 3 distractors from the **same language** (any topic)
- Shuffle all 4 options before presenting
- Direction 1: *"What does [word] mean?"* → 4 meaning options
- Direction 2: *"How do you say [meaning]?"* → 4 word options
- Direction 3: *"What does [character] mean?"* → 4 meaning options
- Direction 4: *"What is the reading of [character]?"* → 4 word (romaji/pinyin) options

**Minimum card guard — MCQ requires at least 4 active cards in the same language:**
- `GET /api/decks` response includes `language_card_count` (total active cards
  across all topics for that language) so the frontend can check before showing MCQ
- Test Setup screen disables the MCQ button and shows: *"Need at least 4 cards
  in [language] to use multiple choice"* if `language_card_count < 4`
- Service layer enforces the same rule as fallback: if fewer than 4 same-language
  cards are available for distractors, pull from **any language** pool instead of
  raising an error (defense in depth for direct API calls)
- `get_distractor_pool(db, language, exclude_card_id)` in `quiz_engine.py` —
  tries same-language first, falls back to global pool if count < 3

### True / False
- 50% correct pair, 50% wrong pairing from same language
- Pre-shuffle to avoid consecutive same-label streaks
- Direction 1: show `word → meaning` pair
- Direction 2: show `meaning → word` pair
- Direction 3: show `native → meaning` pair
- Direction 4: show `native → word` pair

### Typing
- Direction 1: show `word` (+ `native` display) → user types `meaning`
- Direction 2: show `meaning` → user types `word` (romaji/pinyin)
- Direction 3: show `native` (characters) → user types `meaning`
- Direction 4: show `native` (characters) → user types `word` (romaji/pinyin)
- Matching: diacritics-insensitive, case-insensitive, whitespace-stripped
- Fuzzy fallback: `difflib.SequenceMatcher` ratio ≥ `TYPING_FUZZY_THRESHOLD`
- Always show correct answer after each attempt

### Hint System

Each direction has its own hint type. User requests a hint via a **"Hint"**
button; each press reveals one more unit. Max 3 hint presses per question.

| Direction | Answer type | Hint mechanism | Example |
|---|---|---|---|
| 1 | `meaning` (Latin) | Letter mask, reveal one letter per press | `p_____e` → `pa____e` → `pa_s__e` |
| 2 | `word` (romaji/pinyin) | Letter mask on romanized form | `n_ h__` → `ni h__` → `ni ha_` |
| 3 | `meaning` (Latin) | Letter mask, same as direction 1 | `h___o` → `he__o` |
| 4 | `word` (romaji/pinyin) | Furigana/pinyin shown above characters | first press reveals full reading |
| 3+4 | any | Secondary hint: show first character of `native` | `你＿` |

**Letter mask rules:**
- Spaces and punctuation are always revealed (never masked)
- First and last letter always revealed on first hint press
- Subsequent presses reveal one random unrevealed letter each time
- Hint button disabled after 3 presses or when answer is fully revealed

**Direction 4 special case (furigana hint):**
- Press 1: show romaji/pinyin reading above the characters
- Press 2: reveal first letter of the reading with letter mask
- Press 3: reveal one more letter

---

## Service Layer — Key Functions

### `app/services/auth.py`
```python
def hash_password(plain: str) -> str:
    """
    Hash a plaintext password using bcrypt.

    Args:
        plain (str): Raw password string from user input.

    Returns:
        str: Bcrypt hash safe to store in the database.

    Notes:
        Never store or log the plain value after this call.
    """

def verify_password(plain: str, hashed: str) -> bool:
    """
    Compare a plaintext password against a stored bcrypt hash.

    Args:
        plain (str): Raw input from login form.
        hashed (str): Value stored in users.hashed_password.

    Returns:
        bool: True if the password matches.
    """

def create_access_token(user_id: int, username: str) -> str:
    """
    Issue a signed JWT access token.

    Args:
        user_id (int): Primary key of the authenticated user.
        username (str): Stored in token payload for convenience.

    Returns:
        str: Encoded JWT. Expires after JWT_EXPIRE_MINUTES.

    Notes:
        Signs with SECRET_KEY from environment. Never hard-code the key.
    """

def decode_access_token(token: str) -> dict:
    """
    Verify and decode a JWT token.

    Args:
        token (str): Raw Bearer token from Authorization header.

    Returns:
        dict: Payload with 'sub' (user_id) and 'username'.

    Notes:
        Raises HTTPException 401 if token is invalid or expired.
    """
```

### `app/services/importer.py`
```python
def normalize_text(text: str) -> str:
    """
    Strip diacritics, lowercase, and strip whitespace for comparison.

    Args:
        text (str): Raw input string.

    Returns:
        str: ASCII-folded, lowercased, stripped string.

    Notes:
        Uses unicodedata.normalize('NFKD') + encode/decode ascii ignore.
        This is the canonical form used for idempotency keys and answer matching.
    """

def compute_idempotency_key(language: str, topic: str, word: str) -> str:
    """
    Deterministic hash for dedup: sha256(language:topic:normalize(word)).

    Args:
        language (str): Deck language identifier (e.g. 'spanish').
        topic (str): Deck topic identifier (e.g. 'greetings').
        word (str): The vocabulary word (raw, not pre-normalized).

    Returns:
        str: Hex digest string (64 chars).
    """

def parse_vocab_file(file_path: Path) -> list[dict]:
    """
    Parse a CSV or TSV vocabulary file into row dicts.

    Args:
        file_path (Path): Absolute path to the .csv or .tsv file.

    Returns:
        list[dict]: Each dict has keys: 'word', 'meaning', 'native' (may be empty).

    Notes:
        - Auto-detects delimiter from file extension.
        - Skips rows where meaning is empty.
        - Lines starting with '#' are treated as comments.
        - Header row is always skipped.
    """

def normalize_deck_label(label: str) -> str:
    """
    Normalize a language or topic label for consistent storage.

    Args:
        label (str): Raw language or topic string from user input.

    Returns:
        str: Lowercased, stripped string (e.g. 'Spanish ' -> 'spanish').

    Notes:
        Applied to both language and topic on every import and deck creation.
        Ensures 'Spanish', 'spanish', '  Spanish  ' all resolve to same deck.
        Called in the service layer so normalization is enforced even on direct
        API calls, not just through the UI.
    """

def import_vocab_file(
    db: Session,
    language: str,
    topic: str,
    file_path: Path,
) -> ImportBatch:
    """
    Idempotent ingest of a vocabulary file into the database.

    Args:
        db (Session): SQLAlchemy session.
        language (str): Target language name (normalized internally).
        topic (str): Target topic name (normalized internally).
        file_path (Path): Path to the source file.

    Returns:
        ImportBatch: ORM instance with rows_parsed/inserted/skipped counts.

    Notes:
        - Normalizes language and topic via normalize_deck_label() before any
          DB operation — caller does not need to pre-normalize.
        - Upserts Deck by (language, topic).
        - Uses INSERT OR IGNORE on idempotency_key — safe to re-run.
        - Commits once after all rows processed (set-based, not row-by-row).
    """
```

### `app/services/quiz_engine.py`
```python
def normalize_text(text: str) -> str:
    """Same as importer.normalize_text — import from a shared utils module."""

def select_cards_for_test(db: Session, deck_id: int, count: int) -> list[Card]:
    """
    Select cards for a single-deck Test session.

    Args:
        db (Session): SQLAlchemy session.
        deck_id (int): Target deck primary key.
        count (int): Number of cards to return.

    Returns:
        list[Card]: Randomly shuffled active cards from the deck.
    """

def select_cards_for_big_test(db: Session, count: int) -> list[Card]:
    """
    Select cards for a Big Test session, weighted toward weakest cards.

    Args:
        db (Session): SQLAlchemy session.
        count (int): Number of cards to return. Must be in {10, 20, 50, 100}.

    Returns:
        list[Card]: Cards ordered by weakness score DESC, then random.

    Notes:
        Cards with no stats (never seen) are treated as maximally weak.
        weakness_score = 1 - (times_correct / times_seen).
    """

def pick_direction(
    preference: str,
    card: Card,
    stats: list[CardStat] | None = None,
) -> str:
    """
    Resolve the actual direction for one question.

    Args:
        preference (str): Session direction preference
            ('1_only', '2_only', '3_only', '4_only',
             '1_and_2', 'all_available', 'random').
        card (Card): The card being tested — used to check if native is
            present before allowing directions 3 or 4.
        stats (list[CardStat] | None): Existing CardStat rows for this card.
            When provided and preference is 'all_available' or 'random',
            the function picks the weakest available direction rather than
            a uniform random choice. Pass None to fall back to uniform random.

    Returns:
        str: One of 'word_to_meaning', 'meaning_to_word',
             'native_to_meaning', 'native_to_word'.

    Notes:
        If preference requests direction 3 or 4 but card.native is empty,
        falls back to direction 1 or 2 respectively.
        When stats are provided, directions never attempted rank highest
        (treated as weakness = 1.0), so unseen directions are tried first.
    """

def build_mcq_question(card: Card, distractors: list[Card], direction: str) -> dict:
    """
    Build one MCQ question dict with shuffled options.

    Args:
        card (Card): The card being tested.
        distractors (list[Card]): Exactly 3 distractor cards.
        direction (str): One of the 4 resolved direction values.

    Returns:
        dict: question text, options list (4 items), correct_answer,
              direction, card_id, native (if present).
    """

def build_true_false_question(card: Card, wrong_answer: str | None, direction: str) -> dict:
    """Build one True/False question. wrong_answer=None means correct pair."""

def build_typing_question(card: Card, direction: str) -> dict:
    """Build one typing prompt."""

def check_answer(user_answer: str, correct_answer: str, fuzzy: bool = False) -> bool:
    """
    Evaluate any answer with diacritics-insensitive, case-insensitive matching.

    Args:
        user_answer (str): Raw string from user input.
        correct_answer (str): Expected answer from the card.
        fuzzy (bool): If True, also accept difflib ratio >= TYPING_FUZZY_THRESHOLD.

    Returns:
        bool: True if the answer is accepted as correct.

    Notes:
        Both sides are normalize_text()-ed before comparison.
        Fuzzy matching is only used for typing mode.
    """
```

### `app/services/progress.py`
```python
def upsert_card_stat(
    db: Session,
    card_id: int,
    direction: str,
    is_correct: bool,
) -> None:
    """
    Increment seen/correct counts for a card+direction pair after an answer.

    Args:
        db (Session): SQLAlchemy session.
        card_id (int): Card that was just answered.
        direction (str): One of 'word_to_meaning', 'meaning_to_word',
            'native_to_meaning', 'native_to_word'.
        is_correct (bool): Whether the answer was correct.

    Notes:
        Uses INSERT ... ON CONFLICT(card_id, direction) DO UPDATE — upsert
        on the composite unique key. Safe to call multiple times.
        One card can have up to 4 rows, one per direction attempted.
    """

def get_weakest_cards(db: Session, limit: int = 20) -> list[dict]:
    """
    Return cards ranked by weakness score across all decks and directions.

    Args:
        db (Session): SQLAlchemy session.
        limit (int): Maximum number of cards to return.

    Returns:
        list[dict]: Each dict contains:
            - card info (word, meaning, native, language, topic)
            - total_seen, total_correct (aggregated across all directions)
            - weakness_score (aggregated, 0.0–1.0)
            - weakest_direction (the single direction with highest dir_weakness)
            - dir_weakness (weakness score for that specific direction)
        Sorted DESC by aggregated weakness_score.

    Notes:
        Cards never seen rank highest (NULL stats treated as weakness = 1.0).
        The weakest_direction field tells the dashboard exactly which
        direction to highlight — e.g. 'You struggle with paisaje in
        Meaning → Word direction'.
    """

def log_study_day(db: Session, cards_seen: int) -> None:
    """
    Record or update today's study log entry.

    Args:
        db (Session): SQLAlchemy session.
        cards_seen (int): Number of cards answered in the completed session.

    Notes:
        Upserts on study_date = today (UTC). Idempotent — safe to call
        multiple times per day; increments sessions + cards_seen on repeat.
    """

def get_streak(db: Session) -> dict:
    """
    Calculate the current daily study streak.

    Args:
        db (Session): SQLAlchemy session.

    Returns:
        dict: {'current_streak': int, 'longest_streak': int,
               'total_days': int, 'studied_today': bool}

    Notes:
        Streak breaks if any calendar day (UTC) is missing from study_logs.
    """
```

> **Shared utility:** `normalize_text` is used by both `importer.py` and
> `quiz_engine.py`. Extract it to `app/utils/text.py` to avoid duplication.

> **Direction 3 and 4 answer checking:** When the answer is `meaning` (dir 3),
> use `check_answer` with diacritics-insensitive matching as normal. When the
> answer is `word`/romaji/pinyin (dir 4), also use `check_answer` — romaji and
> pinyin are Latin script so diacritics-insensitive matching handles tone marks
> automatically (nǐ == ni). Character input (dirs 5–6, out of scope for v1) would
> require exact Unicode match instead.

> **Hint utility:** Add `app/utils/hint.py` with:
> - `generate_letter_mask(answer: str, revealed: set[int]) -> str` — builds the
>   masked string (e.g. `p_____e`) given a set of already-revealed indices
> - `next_reveal(answer: str, revealed: set[int]) -> int` — picks the next index
>   to reveal (random unrevealed non-space, non-punctuation position)
> These are pure functions with no DB dependency — easy to unit test.

---

## Frontend — Screens

0. **Login** — username + password; JWT stored in `sessionStorage`; all
   screens redirect here if no token found

1. **Home / Dashboard**
   - Language deck cards grouped by language, with card counts per topic
   - Current streak display
   - Weakest cards preview (top 5 across all decks)
   - Two prominent buttons: **Test** and **Big Test**

2. **Test Setup** — pick language → pick topic → pick mode (MCQ / T-F / Typing)
   → pick direction → Start
   - Direction options shown depend on language:
     - Spanish/Norsk: `Word → Meaning` | `Meaning → Word` | `Both`
     - Japanese/Mandarin: above + `Characters → Meaning` | `Characters → Reading` | `All available` | `Random`
   - If language has < 4 cards: MCQ option is disabled with tooltip

3. **Big Test Setup** — pick mode → pick count (10 / 20 / 50 / 100) → Start
   - Direction is locked to directions 1 and 2 (not user-selectable)
   - No language/topic filter — pulls from all decks
   - Every question card shows the language pill badge so you always know
     which language you are being tested on

4. **Quiz** — card-by-card question view
   - Progress bar (e.g. 7 / 20)
   - **Language pill badge** on every card (colored, always visible):
     `ES` red `#E63946` / `ZH` gold `#F4A261` / `JA` indigo `#4361EE` / `NO` teal `#2A9D8F`
   - Shows `native` script below the word when present (display only,
     directions 1 and 2) or as the main prompt (directions 3 and 4)
   - **Hint button** — max 3 presses per question; changes to disabled state
     after 3 presses; shows hint inline below the input
   - Correct/incorrect feedback after each answer
   - Shows correct answer regardless of outcome (typing mode always)

5. **Results** — session score summary
   - Percentage score + correct/total count
   - Per-card breakdown (word, your answer, correct answer)
   - "Retry missed cards" button
   - "Back to Home" button

6. **Browse** — paginated card table filterable by language + topic + search

7. **Import** — drag-and-drop or file picker
   - **Language**: dropdown populated from existing deck languages + "New language"
     option that reveals a text input. Input is always normalized to lowercase
     on submit — `Spanish` and `spanish` resolve to the same deck
   - **Topic**: dropdown populated from existing topics for the selected language
     + "New topic" option that reveals a text input. Also normalized to lowercase
   - Shows import result summary (inserted / skipped counts) after upload
   - Returns a `413` error with a readable message if file exceeds `MAX_UPLOAD_SIZE_MB`

8. **Progress** — dashboard with:
   - Streak calendar (last 30 days, day squares colored if studied)
   - Per-language correct rate (simple stat blocks, aggregated across directions)
   - Weakest cards table (all decks, sorted by aggregated weakness score)
     — each row shows the word, language pill, aggregated weakness, and a
     **direction badge** highlighting the weakest direction for that card
     (e.g. *"Struggles with: Meaning → Word"*) so you know exactly what to work on

All screens are single-page; JS swaps `display:none` sections. No routing
library.

### Dark / Light Mode
- Defaults to system preference via `prefers-color-scheme` media query
- Toggle button (sun/moon icon) in the navbar — persists choice in `localStorage`
- Implemented via CSS custom properties on `[data-theme]` attribute on `<html>`

**Design tokens:**

| Token | Light | Dark |
|---|---|---|
| `--bg-primary` | `#FFFFFF` | `#0F0F0F` |
| `--bg-secondary` | `#F5F5F5` | `#1A1A1A` |
| `--bg-card` | `#FFFFFF` | `#242424` |
| `--text-primary` | `#1A1A1A` | `#F0F0F0` |
| `--text-secondary` | `#6B6B6B` | `#A0A0A0` |
| `--border` | `#E0E0E0` | `#2E2E2E` |
| `--accent` | `#4361EE` | `#4361EE` |

**Language pill colors (identical in both modes):**

| Language | Color | Hex | Label |
|---|---|---|---|
| Spanish | Red | `#E63946` | `ES` |
| Mandarin | Gold | `#F4A261` | `ZH` |
| Japanese | Indigo | `#4361EE` | `JA` |
| Norsk | Teal | `#2A9D8F` | `NO` |

These colors also serve as accent colors on the dashboard stat blocks and
weakest cards table — consistent visual language across the whole app.

---

## Configuration (`.env.example`)

```env
# Database
DATABASE_URL=sqlite:///./flashcards.db
# Production: DATABASE_URL=postgresql+asyncpg://user:pass@host/lexio

# Auth
SECRET_KEY=change-me-to-a-long-random-string
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080

# First-run seed (used by scripts/seed_user.py)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me

# App behaviour
DATA_DIR=./data/languages
TYPING_FUZZY_THRESHOLD=0.85
DEFAULT_QUIZ_CARD_COUNT=20
BIG_TEST_CARD_OPTIONS=10,20,50,100
MAX_UPLOAD_SIZE_MB=5
HINT_MAX_PRESSES=3
```

---

## Testing Requirements

### `tests/test_auth.py`
- [ ] `hash_password` never returns the plaintext value
- [ ] `verify_password` True for correct, False for wrong password
- [ ] `create_access_token` produces a decodable JWT
- [ ] `decode_access_token` raises 401 on expired token
- [ ] `decode_access_token` raises 401 on tampered token
- [ ] `POST /api/auth/login` returns token for valid credentials
- [ ] `POST /api/auth/login` returns 401 for wrong password
- [ ] Protected endpoint returns 401 with no token

### `tests/test_importer.py`
- [ ] `normalize_text` strips diacritics (café→cafe, å→a, nǐ→ni)
- [ ] `normalize_deck_label` lowercases and strips whitespace
- [ ] `normalize_deck_label` ensures 'Spanish' and 'spanish' resolve to same deck
- [ ] `compute_idempotency_key` is deterministic and case-insensitive
- [ ] Parses valid CSV with `native` column
- [ ] Parses valid TSV
- [ ] Skips rows with empty meaning
- [ ] Skips comment lines (`#`)
- [ ] Re-importing the same file does not create duplicate cards
- [ ] `rows_skipped` count is correct after re-import
- [ ] Same word in different topics are treated as distinct cards
- [ ] `POST /api/import` returns 413 when file size exceeds `MAX_UPLOAD_SIZE_MB`
- [ ] `POST /api/import` 413 response body contains a readable error message

### `tests/test_quiz_engine.py`
- [ ] MCQ always has exactly 4 options
- [ ] MCQ correct answer is always in the options list
- [ ] Distractors come from the same language (not necessarily same topic)
- [ ] `get_distractor_pool` falls back to global pool when same-language count < 3
- [ ] MCQ with only 3 total cards in language does not crash — uses cross-language fallback
- [ ] True/False distribution is roughly 50/50 over 100 samples
- [ ] `check_answer` passes on exact match
- [ ] `check_answer` passes diacritics-insensitive (café == cafe)
- [ ] `check_answer` passes on fuzzy match (ratio ≥ 0.85)
- [ ] `check_answer` fails below fuzzy threshold
- [ ] `pick_direction` with preference `3_only` falls back to direction 1 when card has no `native`
- [ ] `pick_direction` with preference `4_only` falls back to direction 2 when card has no `native`
- [ ] `pick_direction('random')` only returns valid directions available for that card
- [ ] `pick_direction` with stats provided picks the weakest direction over uniform random
- [ ] `pick_direction` with stats treats never-attempted directions as weakness = 1.0
- [ ] Direction 3 question shows `native` as the prompt, not `word`
- [ ] Direction 4 question shows `native` as the prompt, answer is `word` (romaji/pinyin)
- [ ] Big Test card selection orders unseen cards first
- [ ] Big Test session direction is always `1_and_2` regardless of input

### `tests/test_progress.py`
- [ ] `upsert_card_stat` increments `times_seen` on every call for the given direction
- [ ] `upsert_card_stat` increments `times_correct` only when `is_correct=True`
- [ ] `upsert_card_stat` produces no duplicate rows — upserts on (card_id, direction)
- [ ] Same card answered in two directions produces two separate rows
- [ ] `get_weakest_cards` aggregates times_seen and times_correct across all directions
- [ ] `get_weakest_cards` returns `weakest_direction` field correctly
- [ ] `get_weakest_cards` ranks cards with high dir_weakness in one direction appropriately
      even if overall weakness is moderate (e.g. 4/5 dir1 correct, 1/5 dir2 correct)
- [ ] `get_weakest_cards` ranks unseen cards highest
- [ ] `log_study_day` creates one row per calendar day
- [ ] `log_study_day` increments `sessions` on second call same day
- [ ] `get_streak` returns 0 when no study logs exist
- [ ] `get_streak` returns correct streak for consecutive days
- [ ] `get_streak` resets after a missed day

---

## Implementation Order (Suggested for Claude Code)

| Phase | Deliverable |
|---|---|
| 1 | `app/config.py` + `app/database.py` |
| 2 | `app/models/` — all ORM models (`user`, `card`, `import_log`, `progress`) |
| 3 | Alembic initial migration |
| 4 | `app/utils/text.py` — `normalize_text`, `normalize_deck_label` + `app/utils/hint.py` — `generate_letter_mask`, `next_reveal` |
| 5 | `app/services/auth.py` + `tests/test_auth.py` |
| 6 | `app/routers/auth.py` + `app/main.py` (minimal — auth only) |
| 7 | `scripts/seed_user.py` |
| 8 | `app/services/importer.py` + `tests/test_importer.py` |
| 9 | `app/routers/import_.py` + `app/routers/decks.py` + `app/routers/cards.py` |
| 10 | `app/services/quiz_engine.py` + `tests/test_quiz_engine.py` |
| 11 | `app/services/progress.py` + `tests/test_progress.py` |
| 12 | `app/routers/quiz.py` + `app/routers/progress.py` |
| 13 | `app/main.py` (complete — all routers, static mount) |
| 14 | `app/static/` — Login + Home + Test Setup + Big Test Setup |
| 15 | `app/static/` — Quiz + Results screens |
| 16 | `app/static/` — Browse + Import + Progress/Dashboard screens |
| 17 | `data/languages/` — sample vocab files (all 4 languages) |
| 18 | `Procfile` + `railway.toml` + deployment verification |
| 19 | `README.md` |

---

## Sample Vocab Files to Generate

### `data/languages/spanish/greetings/basics.csv`
```csv
word,meaning,native
hola,hello,
adiós,goodbye,
gracias,thank you,
por favor,please,
sí,yes,
no,no,
```

### `data/languages/mandarin/hsk1/vocab.csv`
```csv
word,meaning,native
ni hao,hello,你好
xie xie,thank you,谢谢
zai jian,goodbye,再见
shi,yes / is,是
bu shi,no / is not,不是
shui,water,水
```

### `data/languages/japanese/n5/basics.csv`
```csv
word,meaning,native
konnichiwa,hello,こんにちは
arigatou,thank you,ありがとう
sayounara,goodbye,さようなら
hai,yes,はい
iie,no,いいえ
mizu,water,水
```

### `data/languages/norsk/greetings/basics.csv`
```csv
word,meaning,native
hei,hello,
ha det,goodbye,
takk,thank you,
ja,yes,
nei,no,
vann,water,
```

---

## Deployment — Railway

### One-time setup
1. Push project to GitHub
2. Railway → New Project → Deploy from GitHub repo
3. Add PostgreSQL plugin (auto-sets `DATABASE_URL`)
4. Set env vars in Railway dashboard:
   ```
   SECRET_KEY=<python -c "import secrets; print(secrets.token_hex(32))">
   ADMIN_USERNAME=yourname
   ADMIN_PASSWORD=strong-password
   JWT_EXPIRE_MINUTES=10080
   TYPING_FUZZY_THRESHOLD=0.85
   BIG_TEST_CARD_OPTIONS=10,20,50,100
   ```
5. Every `git push` to `main` triggers auto-deploy

### `Procfile`
```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
release: alembic upgrade head && python scripts/seed_user.py
```

### `railway.toml`
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn app.main:app --host 0.0.0.0 --port $PORT"
```

### `requirements.txt` must include
```
fastapi
uvicorn[standard]
sqlalchemy
alembic
psycopg2-binary
python-jose[cryptography]
passlib[bcrypt]
python-dotenv
pydantic-settings
pytest
pytest-asyncio
httpx
```

> `httpx` is required for FastAPI's `TestClient` in async tests.

### Local dev vs Railway prod

| Setting | Local | Railway |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./flashcards.db` | Auto-set by PostgreSQL plugin |
| `SECRET_KEY` | Any string | Strong random hex |
| HTTPS | None | Automatic |
| Domain | `localhost:8000` | `lexio.up.railway.app` |

---

## Security Notes

- Passwords: bcrypt via `passlib` — never stored or logged in plaintext
- `SECRET_KEY`: always from env — never commit to repo
- All API routes except `/api/auth/login` require valid JWT
- JWT stored in `sessionStorage` (clears on tab close)
- Railway provides TLS — all traffic encrypted in transit
- Single-user v1; `users` table supports multi-user in v2

---

## Out of Scope (v1)

- Multi-user accounts
- Spaced repetition algorithm (SM-2)
- Audio pronunciation
- Romaji-to-kana live conversion in the typing input
- Mobile app
- Offline mode
