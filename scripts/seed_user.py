import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password


def _seed(username: str, password: str, label: str) -> None:
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == username).first():
            print(f"{label} user '{username}' already exists — skipping.")
            return
        db.add(User(
            username=username,
            hashed_password=hash_password(password),
            is_active=True,
        ))
        db.commit()
        print(f"{label} user '{username}' created.")
    finally:
        db.close()


if __name__ == "__main__":
    _seed(settings.ADMIN_USERNAME, settings.ADMIN_PASSWORD, "Admin")
    _seed(settings.DEMO_USERNAME,  settings.DEMO_PASSWORD,  "Demo")
