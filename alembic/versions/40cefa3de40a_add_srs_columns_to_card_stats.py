"""add srs columns to card_stats

Revision ID: 40cefa3de40a
Revises: 53927ada82b4
Create Date: 2026-05-21 15:58:04.536275

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '40cefa3de40a'
down_revision: Union[str, None] = '53927ada82b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('card_stats', sa.Column('srs_interval', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('card_stats', sa.Column('srs_ease_factor', sa.Float(), nullable=False, server_default='2.5'))
    op.add_column('card_stats', sa.Column('srs_due_date', sa.Date(), nullable=True))
    op.add_column('card_stats', sa.Column('srs_repetitions', sa.Integer(), nullable=False, server_default='0'))
    op.create_index('idx_card_stats_due', 'card_stats', ['srs_due_date'], unique=False)
    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_scope', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_scope',
            "scope IN ('test','big_test','review')",
        )


def downgrade() -> None:
    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_constraint('ck_quiz_sessions_scope', type_='check')
        batch_op.create_check_constraint(
            'ck_quiz_sessions_scope',
            "scope IN ('test','big_test')",
        )
    op.drop_index('idx_card_stats_due', table_name='card_stats')
    op.drop_column('card_stats', 'srs_repetitions')
    op.drop_column('card_stats', 'srs_due_date')
    op.drop_column('card_stats', 'srs_ease_factor')
    op.drop_column('card_stats', 'srs_interval')
