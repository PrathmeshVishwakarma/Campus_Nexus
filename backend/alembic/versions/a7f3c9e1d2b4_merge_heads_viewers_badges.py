"""merge push-subscriptions and reads/prefs branches; folder view-only members; badge pref

Revision ID: a7f3c9e1d2b4
Revises: 9c4d1a7b2e60, 9c4e2a7b5d10
Create Date: 2026-11-18
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a7f3c9e1d2b4'
down_revision: Union[str, Sequence[str], None] = ('9c4d1a7b2e60', '9c4e2a7b5d10')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if 'viewers' not in _cols('folder_acl'):
        with op.batch_alter_table('folder_acl') as b:
            b.add_column(sa.Column('viewers', sa.JSON(), nullable=True))
    if 'badges' not in _cols('notification_preferences'):
        with op.batch_alter_table('notification_preferences') as b:
            b.add_column(sa.Column('badges', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table('notification_preferences') as b:
        b.drop_column('badges')
    with op.batch_alter_table('folder_acl') as b:
        b.drop_column('viewers')
