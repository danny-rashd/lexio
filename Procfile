web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
release: alembic upgrade head && python scripts/seed_user.py && python scripts/bulk_import.py
