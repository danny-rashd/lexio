"""add user_id to activity tables

Revision ID: b66d0bd849a2
Revises: 10e43ed1e098
Create Date: 2026-05-22 22:04:11.463971

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'b66d0bd849a2'
down_revision: Union[str, None] = '10e43ed1e098'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # card_stats — add user_id, swap unique constraint to include user_id
    with op.batch_alter_table('card_stats') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.drop_constraint('uq_card_stats_card_direction', type_='unique')
        batch_op.create_unique_constraint(
            'uq_card_stats_user_card_direction', ['user_id', 'card_id', 'direction']
        )
        batch_op.create_index('idx_card_stats_user', ['user_id'])

    # quiz_sessions
    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))

    # quiz_answers
    with op.batch_alter_table('quiz_answers') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))

    # study_logs — add user_id, swap unique from (study_date) to (user_id, study_date)
    with op.batch_alter_table('study_logs') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_unique_constraint('uq_study_log_user_date', ['user_id', 'study_date'])

    # immersion_logs
    with op.batch_alter_table('immersion_logs') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))

    # essay_submissions
    with op.batch_alter_table('essay_submissions') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    with op.batch_alter_table('essay_submissions') as batch_op:
        batch_op.drop_column('user_id')

    with op.batch_alter_table('immersion_logs') as batch_op:
        batch_op.drop_column('user_id')

    with op.batch_alter_table('study_logs') as batch_op:
        batch_op.drop_constraint('uq_study_log_user_date', type_='unique')
        batch_op.drop_column('user_id')

    with op.batch_alter_table('quiz_answers') as batch_op:
        batch_op.drop_column('user_id')

    with op.batch_alter_table('quiz_sessions') as batch_op:
        batch_op.drop_column('user_id')

    with op.batch_alter_table('card_stats') as batch_op:
        batch_op.drop_index('idx_card_stats_user')
        batch_op.drop_constraint('uq_card_stats_user_card_direction', type_='unique')
        batch_op.create_unique_constraint('uq_card_stats_card_direction', ['card_id', 'direction'])
        batch_op.drop_column('user_id')
