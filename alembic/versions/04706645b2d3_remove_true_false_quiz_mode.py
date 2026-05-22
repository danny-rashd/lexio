"""remove true_false quiz mode

Revision ID: 04706645b2d3
Revises: 9deeb19f9883
Create Date: 2026-05-23 02:04:30.510779

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '04706645b2d3'
down_revision: Union[str, None] = '9deeb19f9883'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove existing true_false sessions and their answers to satisfy the new constraint
    conn = op.get_bind()
    conn.execute(sa.text(
        "DELETE FROM quiz_answers WHERE session_id IN "
        "(SELECT id FROM quiz_sessions WHERE mode = 'true_false')"
    ))
    conn.execute(sa.text("DELETE FROM quiz_sessions WHERE mode = 'true_false'"))

    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_mode', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_mode',
            "mode IN ('mcq','typing','flashcard')",
        )


def downgrade() -> None:
    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_mode', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_mode',
            "mode IN ('mcq','true_false','typing','flashcard')",
        )
