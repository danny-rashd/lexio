"""add structured resource fields to immersion_logs

Revision ID: 10e43ed1e098
Revises: a7e8df3a3c85
Create Date: 2026-05-22 21:34:46.184173

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '10e43ed1e098'
down_revision: Union[str, None] = 'a7e8df3a3c85'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('immersion_logs') as batch_op:
        batch_op.add_column(sa.Column('resource_type',    sa.String(), nullable=True))
        batch_op.add_column(sa.Column('resource_creator', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('resource_detail',  sa.String(), nullable=True))
        batch_op.alter_column('resource', existing_type=sa.VARCHAR(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table('immersion_logs') as batch_op:
        batch_op.alter_column('resource', existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column('resource_detail')
        batch_op.drop_column('resource_creator')
        batch_op.drop_column('resource_type')
