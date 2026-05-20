# Lexio

A personal language flashcard web app for studying Spanish, Mandarin, Japanese, and Norsk. Import vocabulary from CSV files and test yourself with multiple-choice, true/false, or typing quizzes across four card directions — including native script prompts for Japanese and Mandarin.

---

## Features

- **4 languages** — Spanish, Mandarin, Japanese, Norsk (extensible to any language)
- **3 quiz modes** — Multiple Choice, True/False, Typing
- **4 quiz directions** — Word→Meaning, Meaning→Word, Characters→Meaning, Characters→Reading
- **Big Test** — cross-language quiz weighted toward your weakest cards
- **Hint system** — letter-reveal hints for typing mode (up to 3 presses)
- **Progress tracking** — per-card, per-direction stats; weakness scores; daily streak
- **Dark / light mode** — follows system preference, toggle in nav
- **Idempotent imports** — re-importing the same file never creates duplicates
- **Railway-ready** — Procfile + railway.toml included

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12 + FastAPI |
| Database | SQLAlchemy 2.x + SQLite (dev) / PostgreSQL (prod) |
| Migrations | Alembic |
| Auth | JWT (`python-jose`) + bcrypt (`passlib`) |
| Frontend | Vanilla JS / HTML / CSS — no build step |
| Testing | pytest |
| Deploy | Railway |

---

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/lexio.git
cd lexio
pip install -r requirements.txt
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` — the defaults work for local development as-is. Never commit this file.

### 3. Run migrations and seed the admin user

```bash
alembic upgrade head
python scripts/seed_user.py
```

### 4. Start the server

```bash
uvicorn app.main:app --reload
```

Open `http://localhost:8000` — log in with the credentials from your `.env` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

---

## Running tests

```bash
pytest tests/ -v
```

All 58 tests should pass.

---

## Importing vocabulary

Vocabulary files live in `data/languages/<language>/<topic>/`. Sample files are included for all four languages.

### File format

```csv
word,meaning,native
konnichiwa,hello,こんにちは
arigatou,thank you,ありがとう
```

| Column | Required | Notes |
|---|---|---|
| `word` | Yes | Romaji / pinyin for JA/ZH; plain word for ES/NO |
| `meaning` | Yes | English translation |
| `native` | No | Kanji / kana / hanzi — leave blank for Latin-script languages |

**Rules:**
- First row must be the header `word,meaning,native`
- Lines starting with `#` are comments and are skipped
- Rows with an empty meaning are skipped
- UTF-8 encoding required (files from Excel/Numbers are auto-detected)
- Re-importing the same file is safe — duplicates are skipped

### Import via the UI

1. Log in → click **Import** in the nav
2. Select language and topic (or type a new one)
3. Drop or browse to your CSV/TSV file → click **Import**

### Import via the API

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"localpass"}' | python -m json.tool | grep access_token | cut -d'"' -f4)

curl -s -X POST "http://localhost:8000/api/import?language=spanish&topic=greetings" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@data/languages/spanish/greetings/basics.csv" | python -m json.tool
```

---

## API docs

With the server running, visit `http://localhost:8000/docs` for the interactive Swagger UI covering all endpoints.

---

## Deployment (Railway)

### One-time setup

1. Push to GitHub
2. Railway → **New Project** → **Deploy from GitHub repo** → select this repo
3. Add a **PostgreSQL** plugin (Railway auto-injects `DATABASE_URL`)
4. Set these environment variables in the Railway dashboard:

| Variable | Value |
|---|---|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ADMIN_USERNAME` | Your chosen username |
| `ADMIN_PASSWORD` | A strong password |
| `JWT_EXPIRE_MINUTES` | `10080` |
| `TYPING_FUZZY_THRESHOLD` | `0.85` |
| `BIG_TEST_CARD_OPTIONS` | `10,20,50,100` |
| `MAX_UPLOAD_SIZE_MB` | `5` |
| `HINT_MAX_PRESSES` | `3` |

5. Redeploy — Railway runs `alembic upgrade head && python scripts/seed_user.py` before switching traffic

### Ongoing deploys

```bash
git add .
git commit -m "your message"
git push origin main   # triggers automatic redeploy
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./flashcards.db` | SQLite locally; auto-set to PostgreSQL on Railway |
| `SECRET_KEY` | — | JWT signing key — **must be set in production** |
| `JWT_ALGORITHM` | `HS256` | JWT algorithm |
| `JWT_EXPIRE_MINUTES` | `10080` | Token lifetime (7 days) |
| `ADMIN_USERNAME` | — | Initial admin account username |
| `ADMIN_PASSWORD` | — | Initial admin account password |
| `TYPING_FUZZY_THRESHOLD` | `0.85` | SequenceMatcher ratio for fuzzy typing match |
| `BIG_TEST_CARD_OPTIONS` | `10,20,50,100` | Allowed card counts for Big Test |
| `MAX_UPLOAD_SIZE_MB` | `5` | Maximum vocabulary file upload size |
| `HINT_MAX_PRESSES` | `3` | Maximum hint presses per question |

---

## Project structure

```
lexio/
├── app/
│   ├── main.py          — FastAPI app factory + static mount
│   ├── config.py        — Settings via pydantic-settings
│   ├── database.py      — SQLAlchemy engine + session
│   ├── models/          — ORM models (User, Deck, Card, CardStat, …)
│   ├── schemas/         — Pydantic I/O shapes
│   ├── services/        — Business logic (auth, importer, quiz_engine, progress)
│   ├── routers/         — HTTP endpoints (auth, decks, cards, import, quiz, progress)
│   ├── utils/           — text.py (normalize), hint.py (letter mask)
│   └── static/          — Vanilla JS/HTML/CSS frontend
├── alembic/             — Database migrations
├── data/languages/      — Sample vocabulary files
├── scripts/
│   └── seed_user.py     — Create initial admin user (idempotent)
├── tests/               — pytest test suite (58 tests)
├── Procfile             — Railway process definition
├── railway.toml         — Railway build config
└── requirements.txt
```
