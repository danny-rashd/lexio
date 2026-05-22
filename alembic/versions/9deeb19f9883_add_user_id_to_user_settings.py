"""add user_id to user_settings

Revision ID: 9deeb19f9883
Revises: b66d0bd849a2
Create Date: 2026-05-22 22:23:05.752984

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '9deeb19f9883'
down_revision: Union[str, None] = 'b66d0bd849a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('user_settings') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=False, server_default='1'))
        batch_op.create_unique_constraint('uq_user_settings_user_key', ['user_id', 'key'])


def downgrade() -> None:
    with op.batch_alter_table('user_settings') as batch_op:
        batch_op.drop_constraint('uq_user_settings_user_key', type_='unique')
        batch_op.drop_column('user_id')
