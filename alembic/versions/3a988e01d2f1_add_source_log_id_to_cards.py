"""add source_log_id to cards

Revision ID: 3a988e01d2f1
Revises: c198f2e32ae5
Create Date: 2026-05-22 15:35:01.576927

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3a988e01d2f1'
down_revision: Union[str, None] = 'c198f2e32ae5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('cards') as batch_op:
        batch_op.add_column(sa.Column('source_log_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_cards_source_log', 'immersion_logs', ['source_log_id'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('cards') as batch_op:
        batch_op.drop_constraint('fk_cards_source_log', type_='foreignkey')
        batch_op.drop_column('source_log_id')
