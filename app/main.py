from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.routers import auth, cards, decks, import_, progress, quiz

app = FastAPI(title="Lexio")

app.include_router(auth.router)
app.include_router(decks.router)
app.include_router(cards.router)
app.include_router(import_.router)
app.include_router(quiz.router)
app.include_router(progress.router)

_static_dir = Path(__file__).parent / "static"
if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
