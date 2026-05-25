# CLAUDE.md — Lexio

This file is read automatically by Claude Code at the start of every session.
Follow every instruction here without exception.

---

## First Thing Every Session

1. Read `README.md` for the current feature overview and project structure
2. Read only the specific files relevant to the task at hand
3. If anything in the code contradicts README.md, flag it before writing any code — do not silently work around it

README.md is the authoritative picture of what is currently built. SPECS.md and ROADMAP.md describe intentions and may be outdated — do not treat them as ground truth.

---

## Protected Files

These files are read-only. Never modify them under any circumstances:

- `CLAUDE.md` (this file)
- `SPECS.md`

If a requirement change is needed mid-session:

1. Stop building immediately
2. Tell me exactly what in the spec needs updating
3. Wait for me to update `SPECS.md` manually
4. Only then continue building with the updated spec

All corrections, clarifications, and decisions made during a session are
logged manually in `docs/CHANGES.md`. You do not write to `CHANGES.md`.

---

## Source of Truth

| Document | Status | Purpose |
| -------- | ------ | ------- |
| `README.md` | Always current | Features, project structure, env vars |
| `CLAUDE.md` | Always current | Rules and constraints |
| `SPECS.md` | Outdated | Original build plan — do not treat as current reality |
| `docs/CHANGES.md` | Outdated | Superseded by git log — ignore |
| `docs/ROADMAP.md` | Outdated | Future intentions — ignore |

When a new feature is added or removed:
1. Update `README.md` (features section + project structure)
2. Update `CLAUDE.md` only if a new architectural rule or constraint was established
3. Do not write to `CHANGES.md`, `SPECS.md`, or `ROADMAP.md`

---

## Architectural Rules (Non-Negotiable)

- `app/main.py` is the entry point only — it creates the FastAPI app, mounts
  static files, and includes routers. No business logic lives here.
- No imports from `app/static/` or any UI layer in service or model files.
- No business logic inside `app/routers/`. Routers call service functions;
  they do not implement logic themselves.
- All constants and settings live in `app/config.py` only. No magic values
  anywhere else in the codebase.
- Every function in `app/services/` must have a complete docstring before the
  phase is considered done.
- Passwords are never stored or logged in plaintext — bcrypt only.
- `SECRET_KEY` is always read from the environment. Never hard-code it.

---

## Docstring Standard (app/services/ files only)

Every function in `app/services/` must follow this exact format:

```python
def function_name(param: type) -> return_type:
    """
    One-line summary of what this function does.

    Args:
        param (type): Description of the parameter.

    Returns:
        type: Description of the return value.

    Notes:
        Any edge cases, constraints, or important behavior to be aware of.
    """
```

---

## Layer Boundaries

| Layer       | Location        | Rule                                 |
| ----------- | --------------- | ------------------------------------ |
| Entry point | `app/main.py`   | App factory only — no logic          |
| Config      | `app/config.py` | All env vars and constants           |
| Models      | `app/models/`   | ORM definitions only — no logic      |
| Schemas     | `app/schemas/`  | Pydantic I/O shapes only             |
| Services    | `app/services/` | All business logic lives here        |
| Routers     | `app/routers/`  | HTTP wiring only — call services     |
| Frontend    | `app/static/`   | Vanilla JS/HTML/CSS only — no Python |

Crossing these boundaries in either direction is a violation, even if it
seems convenient.

---

## Phase Discipline

- Build only the phase you are explicitly asked to build
- Touch only the files listed under that phase in `SPECS.md`
- Do not modify any file outside the stated scope, even if you think it
  would help
- Do not refactor code from previous phases unless explicitly asked
- After writing code, run it to verify it works before declaring done
- Verify every acceptance criterion listed in the phase before finishing

---

## Phases (from SPECS.md Implementation Order)

| Phase | Deliverable                                                 | Verify with                                                                        |
| ----- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1     | `app/config.py` + `app/database.py`                         | `python -c "from app.database import engine; print('ok')"`                         |
| 2     | `app/models/` (all ORM models)                              | `python -c "from app.models import user, card, import_log, progress; print('ok')"` |
| 3     | Alembic initial migration                                   | `alembic upgrade head`                                                             |
| 4     | `app/services/auth.py` + `tests/test_auth.py`               | `pytest tests/test_auth.py`                                                        |
| 5     | `app/routers/auth.py`                                       | `uvicorn app.main:app --reload` → POST `/api/auth/login`                           |
| 6     | `scripts/seed_user.py`                                      | `python scripts/seed_user.py` (idempotent)                                         |
| 7     | `app/services/importer.py` + `tests/test_importer.py`       | `pytest tests/test_importer.py`                                                    |
| 8     | `app/services/quiz_engine.py` + `tests/test_quiz_engine.py` | `pytest tests/test_quiz_engine.py`                                                 |
| 9     | `app/services/progress.py` + `tests/test_progress.py`       | `pytest tests/test_progress.py`                                                    |
| 10    | `app/routers/` (decks, cards, import, quiz)                 | `uvicorn app.main:app --reload` → test each endpoint                               |
| 11    | `app/main.py` (complete)                                    | App starts, `/docs` loads                                                          |
| 12    | `app/static/` (frontend)                                    | Login screen → full quiz flow in browser                                           |
| 13    | `data/languages/` sample files                              | Import via UI or API                                                               |
| 14    | `Procfile` + `railway.toml`                                 | `git push` triggers Railway deploy                                                 |
| 15    | `README.md`                                                 | Read-through only                                                                  |

---

## After Writing Each Phase

Run the app:

```bash
uvicorn app.main:app --reload
```

Run tests (after Phase 4 and beyond):

```bash
pytest tests/
```

Check the interactive API docs at `http://localhost:8000/docs` to verify
endpoints are correctly wired before moving to the next phase.

---

## Environment Setup

Local `.env` file (never committed to git):

```env
DATABASE_URL=sqlite:///./flashcards.db
SECRET_KEY=any-local-dev-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=localpass
JWT_EXPIRE_MINUTES=10080
TYPING_FUZZY_THRESHOLD=0.85
DEFAULT_QUIZ_CARD_COUNT=20
DATA_DIR=./data/languages
```

`.env` must be listed in `.gitignore`. Never commit credentials.

---

## Code Quality Rules

- No hardcoded values outside of `app/config.py`
- No commented-out code left in files
- No debug `print()` statements left in files
- No partial implementations — every file must be complete and runnable
- No `# TODO` or `# rest of code here` placeholders
- All type hints required on every function signature in `app/services/`
- `requirements.txt` must stay in sync — add any new dependency immediately

---

## Database Rules

- All schema changes go through Alembic migrations — never edit the DB directly
- Every new migration must be generated with:
  ```bash
  alembic revision --autogenerate -m "short description"
  ```
- `seed_user.py` must be idempotent — skip if user already exists, never error
- Never drop or truncate tables in migrations without explicit instruction

---

## Security Rules

- Passwords: bcrypt hash via `passlib` — never store or log plaintext
- `SECRET_KEY`: always from `app/config.py` → env var — never hard-coded
- JWT tokens: always validated on every protected endpoint via FastAPI dependency
- `ADMIN_PASSWORD` in `.env` is for local dev only — Railway uses its own env vars

---

## If Something is Ambiguous

Stop. Ask one clarifying question before writing any code.
Do not make assumptions and proceed — ambiguity resolved wrong wastes a
full phase.

---

## Project Reference

| Item          | Value                           |
| ------------- | ------------------------------- |
| Full spec     | `SPECS.md`                      |
| Change log    | `docs/CHANGES.md`               |
| Entry point   | `app/main.py`                   |
| Run app       | `uvicorn app.main:app --reload` |
| Run tests     | `pytest tests/`                 |
| API docs      | `http://localhost:8000/docs`    |
| Dependencies  | `requirements.txt`              |
| Deploy target | Railway (`git push` to `main`)  |
