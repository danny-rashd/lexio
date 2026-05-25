"""add_conjugations_table

Revision ID: 6109736d3939
Revises: 4cb680880ce0
Create Date: 2026-05-25 15:07:46.653946

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6109736d3939'
down_revision: Union[str, None] = '4cb680880ce0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'conjugations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('card_id', sa.Integer(), sa.ForeignKey('cards.id'), nullable=False),
        sa.Column('data', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('(datetime(\'now\'))'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('card_id', name='uq_conjugations_card_id'),
    )


def downgrade() -> None:
    op.drop_table('conjugations')
