"""
Export all conjugation data from the local DB to data/conjugations.json.
Keyed by card idempotency_key so it can be re-imported into any environment.

Usage:
    python scripts/export_conjugations.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models.card import Card
from app.models.conjugation import Conjugation

OUTPUT = Path(__file__).resolve().parent.parent / "data" / "conjugations.json"


def main() -> None:
    db = SessionLocal()
    try:
        rows = (
            db.query(Card.idempotency_key, Conjugation.data)
            .join(Conjugation, Card.id == Conjugation.card_id)
            .order_by(Card.idempotency_key)
            .all()
        )
    finally:
        db.close()

    records = [{"key": key, "data": json.loads(data)} for key, data in rows]
    OUTPUT.write_text(json.dumps(records, ensure_ascii=False, indent=2))
    print(f"Exported {len(records)} conjugation records → {OUTPUT}")


if __name__ == "__main__":
    main()
