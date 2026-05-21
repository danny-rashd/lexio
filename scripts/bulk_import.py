import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings
from app.database import SessionLocal
from app.services.importer import import_vocab_file


def bulk_import() -> None:
    data_dir = Path(settings.DATA_DIR)
    if not data_dir.exists():
        print(f"DATA_DIR '{data_dir}' does not exist — skipping bulk import.")
        return

    db = SessionLocal()
    total_inserted = 0
    total_skipped = 0

    try:
        for lang_dir in sorted(data_dir.iterdir()):
            if not lang_dir.is_dir():
                continue
            language = lang_dir.name

            for topic_dir in sorted(lang_dir.iterdir()):
                if not topic_dir.is_dir():
                    continue
                topic = topic_dir.name

                files = sorted(
                    list(topic_dir.glob("*.csv")) + list(topic_dir.glob("*.tsv"))
                )
                for csv_file in files:
                    batch = import_vocab_file(db, language, topic, csv_file)
                    print(
                        f"  {language}/{topic}/{csv_file.name}: "
                        f"parsed={batch.rows_parsed}  "
                        f"inserted={batch.rows_inserted}  "
                        f"skipped={batch.rows_skipped}"
                    )
                    total_inserted += batch.rows_inserted
                    total_skipped += batch.rows_skipped
    finally:
        db.close()

    print(f"\nBulk import complete — inserted: {total_inserted}, skipped: {total_skipped}")


if __name__ == "__main__":
    bulk_import()
