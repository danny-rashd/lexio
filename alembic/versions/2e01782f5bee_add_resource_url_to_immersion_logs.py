"""add resource_url to immersion_logs

Revision ID: 2e01782f5bee
Revises: 6109736d3939
Create Date: 2026-05-25 22:01:48.837638

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2e01782f5bee'
down_revision: Union[str, None] = '6109736d3939'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('immersion_logs', sa.Column('resource_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('immersion_logs', 'resource_url')
