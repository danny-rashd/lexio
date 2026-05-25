"""add sentence to cards and cloze quiz mode

Revision ID: f522f2231bab
Revises: 04706645b2d3
Create Date: 2026-05-25 12:05:22.814602

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f522f2231bab'
down_revision: Union[str, None] = '04706645b2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('cards', sa.Column('sentence', sa.String(), nullable=True))

    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_mode', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_mode',
            "mode IN ('mcq','typing','flashcard','cloze')",
        )


def downgrade() -> None:
    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_mode', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_mode',
            "mode IN ('mcq','typing','flashcard')",
        )

    op.drop_column('cards', 'sentence')
