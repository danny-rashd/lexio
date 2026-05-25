"""
Seed conjugation data from data/conjugations.json into the DB.
Idempotent — skips cards that already have conjugation data.

Usage:
    python scripts/seed_conjugations.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models.card import Card
from app.models.conjugation import Conjugation

SOURCE = Path(__file__).resolve().parent.parent / "data" / "conjugations.json"


def main() -> None:
    if not SOURCE.exists():
        print("data/conjugations.json not found — skipping.")
        return

    records = json.loads(SOURCE.read_text())
    db = SessionLocal()
    try:
        existing_keys = {
            row[0] for row in
            db.query(Card.idempotency_key)
            .join(Conjugation, Card.id == Conjugation.card_id)
            .all()
        }

        inserted = 0
        for rec in records:
            if rec["key"] in existing_keys:
                continue
            card = db.query(Card).filter(Card.idempotency_key == rec["key"]).first()
            if not card:
                continue
            db.add(Conjugation(card_id=card.id, data=json.dumps(rec["data"], ensure_ascii=False)))
            inserted += 1

        db.commit()
        print(f"Seeded {inserted} conjugation records (skipped {len(records) - inserted} existing).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
