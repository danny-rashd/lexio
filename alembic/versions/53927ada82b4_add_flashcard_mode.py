"""add flashcard mode

Revision ID: 53927ada82b4
Revises: 262b4f1c694a
Create Date: 2026-05-21 15:32:17.917480

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '53927ada82b4'
down_revision: Union[str, None] = '262b4f1c694a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("quiz_sessions") as batch_op:
        batch_op.drop_constraint("ck_quiz_sessions_mode", type_="check")
        batch_op.create_check_constraint(
            "ck_quiz_sessions_mode",
            "mode IN ('mcq','true_false','typing','flashcard')",
        )


def downgrade() -> None:
    with op.batch_alter_table("quiz_sessions") as batch_op:
        batch_op.drop_constraint("ck_quiz_sessions_mode", type_="check")
        batch_op.create_check_constraint(
            "ck_quiz_sessions_mode",
            "mode IN ('mcq','true_false','typing')",
        )
