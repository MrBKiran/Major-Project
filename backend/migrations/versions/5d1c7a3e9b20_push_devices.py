"""push devices

Revision ID: 5d1c7a3e9b20
Revises: 067fefd9af38
Create Date: 2026-10-20 23:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5d1c7a3e9b20'
down_revision: Union[str, None] = '067fefd9af38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'push_devices',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=32), nullable=False),
        sa.Column('token', sa.String(length=200), nullable=False),
        sa.Column('platform', sa.String(length=8), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    op.create_index(op.f('ix_push_devices_user_id'), 'push_devices', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_push_devices_user_id'), table_name='push_devices')
    op.drop_table('push_devices')
