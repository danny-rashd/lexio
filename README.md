# Lexio

A personal language flashcard web app. Study vocabulary across six languages with multiple quiz modes, spaced repetition, AI essay feedback, immersion tracking, translation, and a full progress dashboard.

---

## Features

### Study
- **6 languages** — Spanish, French, German, Norwegian, Japanese, Mandarin
- **4 quiz modes** — Multiple Choice (MCQ), Typing, Flashcard, Cloze (fill-in-the-blank with example sentences)
- **4 quiz directions** — Word→Meaning, Meaning→Word, Characters→Meaning, Characters→Reading
- **Hint system** — letter-reveal hints for typing mode (up to 3 presses)
- **Text-to-speech** — 🔊 button on every quiz card and browse row; uses Google Cloud Neural2/WaveNet voices when `GOOGLE_TTS_API_KEY` is set, falls back to browser Web Speech API otherwise

### Spaced Repetition (SRS)
- **SM-2 algorithm** — Flashcard mode grades (Again / Hard / Good / Easy) schedule each card on a due date
- **Review sessions** — one-click review of only the cards due today, straight from the home screen
- **SRS health** — per-language breakdown of New / Learning / Mature / Overdue cards on the Progress screen

### Testing
- **Big Test (Total Recall)** — cross-language quiz weighted toward your weakest cards; select which languages to include
- **Retry missed** — restart a session with only the cards you got wrong
- **Daily goal** — configurable card target with a progress bar on the home screen

### Vocabulary Management
- **CSV / TSV import** — standard `word,meaning,native,sentence,ipa,notes` format; re-importing is fully idempotent
- **Anki import** — upload `.apkg` files directly; map Anki fields to word/meaning/native before confirming
- **Deck export** — download any deck as a `.lex` file (CSV with metadata comments); re-import preserves language and topic automatically
- **Deck delete** — hard delete a deck and all its cards from the UI
- **Browse** — paginated, searchable card table with sticky first column on mobile

### Translation
- **Bidirectional translation** — translate text between English, Spanish, French, German, Norwegian, Japanese, and Mandarin using Google Cloud Translation API
- **Romanization** — automatic Hepburn romaji (Japanese) and pinyin (Mandarin) shown alongside translations
- **Word mining from translation** — extract new vocabulary from translated output and save directly to a deck, with uniqueness checks against existing cards

### AI Features
- **Essay evaluation** — write an essay in any study language and receive instant AI feedback via Claude Haiku: Grammar (30%), Diacritics (20%), Spelling (20%), Fluency (15%), Punctuation (15%)
- **Language detection** — essays are checked against the selected language before being sent for evaluation; mismatches are blocked or flagged
- **Text mining** — paste a foreign-language text into a journal entry to extract vocabulary; Latin-script languages use a pure-Python tokeniser, CJK languages use DeepSeek for segmentation and meanings

### Conjugation Reference
- **Verb conjugation tables** — browse conjugations for vocabulary words seeded from `data/conjugations.json`
- **Language tabs and verb search** — filterable by language with instant search across all seeded verbs

### Immersion Journal
- **Session logging** — log time spent on any immersion activity (Watching, Listening, Reading, Speaking, Writing, Gaming, Other) with structured resource fields (type, creator, title/episode)
- **Add words from entries** — manually add vocabulary from a log entry directly to your deck
- **Parse text** — paste text from what you were reading/watching and extract new words to save

### Progress & Analytics
- **Activity heatmap** — 13-week calendar showing study intensity by day (quiz cards + immersion + essays); hover to see that day's breakdown
- **Language proficiency** — per-language progress bars with Beginner/Developing/Proficient/Fluent badges; expandable per-direction breakdown
- **Study Investment** — side-by-side quiz cards vs immersion time per language
- **Essay sparklines** — per-language score trend line across all submissions
- **Immersion activity mix** — stacked bars showing how immersion time is split by activity type per language
- **Streak tracking** — current streak, longest streak, 30-day calendar

### Accounts & Privacy
- **Admin + Demo accounts** — admin account for personal use; demo account for public proof-of-concept
- **Per-user data isolation** — all activity data (stats, sessions, streaks, journal, essays) is fully isolated per user; shared vocabulary is accessible to both
- **Try Demo** — one-click guest access via a dedicated `/api/auth/demo` endpoint (no credentials in the frontend)
- **Language visibility** — hide any language from the home page, dropdowns, and quizzes without deleting it; toggle per language from the Progress screen

### UX & PWA
- **Dark / light mode** — follows system preference; toggle in the nav bar
- **Import preview** — see a preview of your file (format, row count, first 3 rows) before committing
- **Human-readable errors** — all API errors translated to plain English in the UI
- **Mobile layout** — responsive nav, sticky browse columns, single-column quiz on narrow screens
- **Installable PWA** — service worker caches the shell for offline-ready access
- **Push notifications** — opt-in browser notifications when you hit your daily goal

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12+ + FastAPI |
| Database | SQLAlchemy 2.x + SQLite (dev) / PostgreSQL (prod) |
| Migrations | Alembic |
| Auth | JWT (`python-jose`) + bcrypt (`passlib`) |
| Frontend | Vanilla JS / HTML / CSS — no build step |
| AI — Essay | Claude Haiku via Anthropic API |
| AI — Text parsing (CJK) | DeepSeek API |
| Translation | Google Cloud Translation API v2 |
| TTS | Google Cloud Text-to-Speech (Neural2/WaveNet); browser Web Speech API fallback |
| Conjugations | `mlconjug3` + `pykakasi` + `pypinyin` (offline) |
| Language detection | `langdetect` (pure Python) |
| Anki parsing | Python `zipfile` + `sqlite3` stdlib |
| Testing | pytest |
| Deploy | Railway |

---

## Local setup

### 1. Clone and create a virtual environment

```bash
git clone https://github.com/<your-username>/lexio.git
cd lexio
python3 -m venv .venv
source .venv/bin/activate        # fish: source .venv/bin/activate.fish
pip install -r requirements.txt
```

### 2. Create your `.env` file

```env
DATABASE_URL=sqlite:///./flashcards.db
SECRET_KEY=any-local-dev-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=localpass
DEMO_USERNAME=demo
DEMO_PASSWORD=demo
JWT_EXPIRE_MINUTES=10080
TYPING_FUZZY_THRESHOLD=0.85
DEFAULT_QUIZ_CARD_COUNT=20
DATA_DIR=./data/languages
ESSAY_MIN_WORDS=20
ESSAY_MAX_WORDS=500
DEEPSEEK_API_KEY=          # required for CJK text parsing
DEEPSEEK_MODEL=deepseek-chat
ANTHROPIC_API_KEY=         # required for essay evaluation
GOOGLE_TTS_API_KEY=        # required for translation and TTS; browser TTS used when absent
```

Never commit `.env` — it is listed in `.gitignore`.

### 3. Run migrations and seed users

```bash
alembic upgrade head
python scripts/seed_user.py
```

### 4. (Optional) Pre-load vocabulary and conjugations

```bash
python scripts/bulk_import.py       # import all CSVs in data/languages/
python scripts/seed_conjugations.py # seed verb conjugation data
```

Both are fully idempotent — safe to run repeatedly.

### 5. Start the server

```bash
uvicorn app.main:app --reload
```

Open `http://localhost:8000`. Log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` or click **Try Demo**.

---

## Running tests

```bash
pytest tests/ -v
```

---

## Vocabulary format

```csv
word,meaning,native,sentence,ipa,notes
konnichiwa,hello,こんにちは,{{konnichiwa}}、元気ですか？,,A general greeting
café,coffee,,Je voudrais un {{café}}.,/ka.fe/,
学习,to study,xuéxí,我喜欢{{学习}}。,,
```

| Column | Required | Notes |
|---|---|---|
| `word` | Yes | Romaji/pinyin for JA/ZH; plain word for ES/FR/DE/NO |
| `meaning` | Yes | English translation |
| `native` | No | Kana/kanji/hanzi — leave blank for Latin-script languages |
| `sentence` | No | Example sentence; wrap the target word in `{{word}}` for cloze mode |
| `ipa` | No | IPA pronunciation |
| `notes` | No | Free-text notes shown on card reveal |

- Lines starting with `#` are comments and are skipped
- Rows with an empty word or meaning are skipped
- UTF-8 encoding recommended (cp1252 and latin-1 are also accepted)
- Re-importing the same file is safe — duplicates are skipped; sentence/ipa/notes are backfilled for existing cards that lack them

---

## Deployment (Railway)

### One-time setup

1. Push to GitHub
2. Railway → **New Project** → **Deploy from GitHub repo**
3. Add a **PostgreSQL** plugin (Railway auto-injects `DATABASE_URL`)
4. Set environment variables in the Railway dashboard:

| Variable | Notes |
|---|---|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ADMIN_USERNAME` | Your personal login username |
| `ADMIN_PASSWORD` | Strong password |
| `DEMO_USERNAME` | Public demo username (default: `demo`) |
| `DEMO_PASSWORD` | Public demo password (default: `demo`) |
| `JWT_EXPIRE_MINUTES` | `10080` (7 days) |
| `ANTHROPIC_API_KEY` | Required for essay evaluation |
| `DEEPSEEK_API_KEY` | Required for CJK text parsing |
| `DEEPSEEK_MODEL` | `deepseek-chat` |
| `GOOGLE_TTS_API_KEY` | Required for translation and TTS |
| `TYPING_FUZZY_THRESHOLD` | `0.85` |
| `MAX_UPLOAD_SIZE_MB` | `5` |

5. First deploy runs `alembic upgrade head && python scripts/seed_user.py && python scripts/bulk_import.py && python scripts/seed_conjugations.py` automatically via the `release` command in `Procfile`

### Ongoing deploys

```bash
git push origin main   # triggers automatic redeploy on Railway
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./flashcards.db` | SQLite locally; auto-set to PostgreSQL on Railway |
| `SECRET_KEY` | — | JWT signing key — **required in production** |
| `JWT_ALGORITHM` | `HS256` | JWT algorithm |
| `JWT_EXPIRE_MINUTES` | `10080` | Token lifetime (7 days) |
| `ADMIN_USERNAME` | — | Admin account username |
| `ADMIN_PASSWORD` | — | Admin account password |
| `DEMO_USERNAME` | `demo` | Demo account username |
| `DEMO_PASSWORD` | `demo` | Demo account password |
| `ANTHROPIC_API_KEY` | — | Required for essay evaluation (Claude Haiku) |
| `DEEPSEEK_API_KEY` | — | Required for CJK text mining (DeepSeek) |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek model ID |
| `GOOGLE_TTS_API_KEY` | — | Required for translation and Cloud TTS; browser TTS is used when not set |
| `VAPID_PUBLIC_KEY` | — | Optional; required for push notifications |
| `VAPID_PRIVATE_KEY` | — | Optional; required for push notifications |
| `VAPID_SUBJECT` | — | Optional; contact email for push notifications |
| `DATA_DIR` | `./data/languages` | Vocabulary file directory |
| `TYPING_FUZZY_THRESHOLD` | `0.85` | SequenceMatcher ratio for fuzzy typing match |
| `DEFAULT_QUIZ_CARD_COUNT` | `20` | Default cards per session |
| `BIG_TEST_CARD_OPTIONS` | `10,20,50,100` | Allowed card counts for Total Recall |
| `MAX_UPLOAD_SIZE_MB` | `5` | Maximum vocabulary file upload size |
| `MAX_UPLOAD_SIZE_APKG_MB` | `200` | Maximum Anki .apkg upload size |
| `ESSAY_MIN_WORDS` | `20` | Minimum words for essay submission |
| `ESSAY_MAX_WORDS` | `500` | Maximum words for essay submission |
| `HINT_MAX_PRESSES` | `3` | Maximum hint presses per quiz question |

---

## Project structure

```
lexio/
├── app/
│   ├── main.py              — FastAPI app factory + static mount
│   ├── config.py            — Settings via pydantic-settings
│   ├── database.py          — SQLAlchemy engine + session
│   ├── models/
│   │   ├── user.py          — User accounts
│   │   ├── card.py          — Deck + Card
│   │   ├── progress.py      — CardStat, QuizSession, QuizAnswer, StudyLog
│   │   ├── conjugation.py   — Verb conjugation data
│   │   ├── essay.py         — EssaySubmission
│   │   ├── immersion.py     — ImmersionLog (journal entries)
│   │   ├── settings.py      — Per-user key/value settings
│   │   ├── push.py          — Push notification subscriptions
│   │   └── import_log.py    — ImportBatch audit trail
│   ├── schemas/             — Pydantic I/O shapes
│   ├── services/
│   │   ├── auth.py          — Password hashing, JWT
│   │   ├── importer.py      — CSV/TSV vocab ingest
│   │   ├── anki_parser.py   — .apkg unzip + SQLite read
│   │   ├── quiz_engine.py   — Card selection, question building, answer checking
│   │   ├── progress.py      — CardStat upsert, streak, weakest cards
│   │   ├── srs.py           — SM-2 spaced repetition algorithm
│   │   ├── essay_evaluator.py — Claude Haiku evaluation + language detection
│   │   ├── text_parser.py   — Latin tokeniser + DeepSeek CJK segmentation
│   │   ├── translate.py     — Google Cloud Translation + romanization + word mining
│   │   ├── tts.py           — Google Cloud TTS synthesis (optional)
│   │   └── push.py          — Web Push notification dispatch
│   ├── routers/
│   │   ├── auth.py          — /api/auth (login, demo, me)
│   │   ├── decks.py         — /api/decks (list, detail, delete, export)
│   │   ├── cards.py         — /api/cards (list, add, delete)
│   │   ├── import_.py       — /api/import (CSV, Anki)
│   │   ├── quiz.py          — /api/quiz (start, answer, result, hint)
│   │   ├── progress.py      — /api/progress (stats, streak, dashboard, heatmap)
│   │   ├── essay.py         — /api/essay (submit, history, stats)
│   │   ├── immersion.py     — /api/immersion (log, list, stats)
│   │   ├── journal.py       — /api/journal (parse-text)
│   │   ├── conjugations.py  — /api/conjugations (by language, by card)
│   │   ├── translate.py     — /api/translate (translate, mine)
│   │   ├── settings.py      — /api/settings (daily-goal, hidden-languages, reset)
│   │   ├── tts.py           — /api/tts (synthesise)
│   │   └── push.py          — /api/push (subscribe, notify)
│   ├── utils/
│   │   ├── text.py          — normalize_text, normalize_deck_label
│   │   └── hint.py          — generate_letter_mask, next_reveal
│   └── static/              — Vanilla JS/HTML/CSS single-page frontend + PWA manifest
├── alembic/                 — Database migrations
├── data/
│   ├── languages/           — Vocabulary CSVs (auto-imported on deploy)
│   └── conjugations.json    — Verb conjugation data (seeded on deploy)
├── scripts/
│   ├── seed_user.py         — Create admin + demo users (idempotent)
│   ├── seed_conjugations.py — Seed conjugation data from conjugations.json (idempotent)
│   ├── bulk_import.py       — Import all vocab files in data/languages/ (idempotent)
│   ├── generate_sentences.py — Generate example sentences for cards via AI
│   ├── generate_ipa.py      — Generate IPA pronunciations for cards via AI
│   ├── generate_notes.py    — Generate usage notes for cards via AI
│   ├── generate_conjugations.py — Generate conjugation data via mlconjug3
│   ├── export_conjugations.py   — Export conjugation data to JSON
│   └── gen_vapid_keys.py    — Generate VAPID keys for push notifications
├── tests/                   — pytest test suite
├── Procfile                 — Railway: web + release commands
├── railway.toml             — Railway build config
└── requirements.txt
```
