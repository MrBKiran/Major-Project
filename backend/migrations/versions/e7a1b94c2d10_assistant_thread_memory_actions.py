"""assistant thread, memory and proposed actions

Revision ID: e7a1b94c2d10
Revises: 5d1c7a3e9b20
Create Date: 2026-11-23 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e7a1b94c2d10'
down_revision: Union[str, None] = '5d1c7a3e9b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('assistant_messages',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('principal_id', sa.String(length=32), nullable=False),
    sa.Column('role', sa.String(length=12), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('vin', sa.String(length=17), nullable=True),
    sa.Column('channel', sa.String(length=16), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_assistant_messages_principal_id'), 'assistant_messages', ['principal_id'], unique=False)
    op.create_table('assistant_memory',
    sa.Column('principal_id', sa.String(length=32), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('summarised_to', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('principal_id')
    )
    op.create_table('assistant_actions',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('principal_id', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('vin', sa.String(length=17), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_assistant_actions_principal_id'), 'assistant_actions', ['principal_id'], unique=False)
    op.create_index(op.f('ix_assistant_actions_status'), 'assistant_actions', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_assistant_actions_status'), table_name='assistant_actions')
    op.drop_index(op.f('ix_assistant_actions_principal_id'), table_name='assistant_actions')
    op.drop_table('assistant_actions')
    op.drop_table('assistant_memory')
    op.drop_index(op.f('ix_assistant_messages_principal_id'), table_name='assistant_messages')
    op.drop_table('assistant_messages')
