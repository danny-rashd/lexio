from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers import auth, cards, decks, essay, immersion, import_, journal, progress, push, quiz, settings, tts

app = FastAPI(title="Lexio")

app.include_router(auth.router)
app.include_router(decks.router)
app.include_router(cards.router)
app.include_router(import_.router)
app.include_router(quiz.router)
app.include_router(progress.router)
app.include_router(essay.router)
app.include_router(immersion.router)
app.include_router(journal.router)
app.include_router(settings.router)
app.include_router(tts.router)
app.include_router(push.router)

_static_dir = Path(__file__).parent / "static"


@app.get("/manifest.json", include_in_schema=False)
def serve_manifest():
    return FileResponse(
        _static_dir / "manifest.json",
        media_type="application/manifest+json",
    )


if _static_dir.is_dir():
    app.mount("/", StaticFiles(directory=_static_dir, html=True), name="static")
