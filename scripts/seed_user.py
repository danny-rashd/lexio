import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password


def seed_admin() -> None:
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.username == settings.ADMIN_USERNAME).first()
        if existing:
            print(f"User '{settings.ADMIN_USERNAME}' already exists — skipping.")
            return

        user = User(
            username=settings.ADMIN_USERNAME,
            hashed_password=hash_password(settings.ADMIN_PASSWORD),
            is_active=True,
        )
        db.add(user)
        db.commit()
        print(f"User '{settings.ADMIN_USERNAME}' created.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_admin()
