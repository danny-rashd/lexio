"""add_ipa_and_notes_to_cards

Revision ID: 4cb680880ce0
Revises: f522f2231bab
Create Date: 2026-05-25 14:12:34.661488

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4cb680880ce0'
down_revision: Union[str, None] = 'f522f2231bab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('cards') as batch_op:
        batch_op.add_column(sa.Column('ipa', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('notes', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('cards') as batch_op:
        batch_op.drop_column('notes')
        batch_op.drop_column('ipa')
