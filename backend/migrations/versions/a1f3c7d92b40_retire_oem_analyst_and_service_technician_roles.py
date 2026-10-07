"""retire oem_analyst and service_technician roles

Revision ID: a1f3c7d92b40
Revises: c43d2142ae32
Create Date: 2026-09-22 03:05:00.000000

The role set drops from ten to eight. Neither retired role had a screen of its
own, and `memberships.role` has no foreign key to the policy, so removing them
from access_policy.yaml alone would leave live rows pointing at an undefined
role. This migration moves those rows (see app/db/role_retirement.py for what
becomes of each role and why) and records every change in `retired_memberships`
so the downgrade can put things back exactly as they were.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.role_retirement import restore_roles, retire_roles


# revision identifiers, used by Alembic.
revision: str = 'a1f3c7d92b40'
down_revision: Union[str, None] = 'c43d2142ae32'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'retired_memberships',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.String(length=32), nullable=False),
        sa.Column('org_id', sa.String(length=32), nullable=False),
        sa.Column('role', sa.String(length=48), nullable=False),
        sa.Column('replaced_by', sa.String(length=48), nullable=True),
        sa.Column('action', sa.String(length=12), nullable=False),
        sa.Column('deactivated_user', sa.Boolean(), nullable=False),
        sa.Column('reason', sa.String(length=240), nullable=False),
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_retired_memberships_user_id'), 'retired_memberships',
                    ['user_id'], unique=False)
    retire_roles(op.get_bind())


def downgrade() -> None:
    restore_roles(op.get_bind())
    op.drop_index(op.f('ix_retired_memberships_user_id'), table_name='retired_memberships')
    op.drop_table('retired_memberships')
