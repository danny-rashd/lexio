import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.database import SessionLocal
from app.models.card import Deck
from app.services.importer import import_vocab_file
from app.services.question_templates import (
    ensure_question_templates,
    read_template_comments,
    write_template_comments,
)

_VALID_CATEGORIES = {"language", "general"}


def bulk_import() -> None:
    data_dir = Path(settings.DATA_DIR)
    if not data_dir.exists():
        print(f"DATA_DIR '{data_dir}' does not exist — skipping bulk import.")
        return

    db = SessionLocal()
    total_inserted = 0
    total_skipped = 0

    try:
        for category_dir in sorted(data_dir.iterdir()):
            if not category_dir.is_dir() or category_dir.name not in _VALID_CATEGORIES:
                continue
            category = category_dir.name

            for subject_dir in sorted(category_dir.iterdir()):
                if not subject_dir.is_dir():
                    continue
                subject = subject_dir.name

                for topic_dir in sorted(subject_dir.iterdir()):
                    if not topic_dir.is_dir():
                        continue
                    topic = topic_dir.name

                    files = sorted(
                        list(topic_dir.glob("*.csv")) + list(topic_dir.glob("*.tsv"))
                    )
                    for csv_file in files:
                        batch = import_vocab_file(db, category, subject, topic, csv_file)
                        print(
                            f"  {category}/{subject}/{topic}/{csv_file.name}: "
                            f"parsed={batch.rows_parsed}  "
                            f"inserted={batch.rows_inserted}  "
                            f"skipped={batch.rows_skipped}"
                        )
                        total_inserted += batch.rows_inserted
                        total_skipped += batch.rows_skipped

                        if category == "general":
                            deck = db.query(Deck).filter(Deck.id == batch.deck_id).first()
                            if deck and not deck.question_template_forward:
                                cached = read_template_comments(csv_file)
                                if cached:
                                    deck.question_template_forward, deck.question_template_reverse = cached
                                    db.commit()
                                    print(f"    → loaded cached question templates for {subject}/{topic} (no API call)")
                                else:
                                    ensure_question_templates(db, deck)
                                    if deck.question_template_forward:
                                        write_template_comments(
                                            csv_file, deck.question_template_forward, deck.question_template_reverse
                                        )
                                        print(f"    → generated question templates for {subject}/{topic} and cached them in the CSV")
    finally:
        db.close()

    print(f"\nBulk import complete — inserted: {total_inserted}, skipped: {total_skipped}")


if __name__ == "__main__":
    bulk_import()
