"""per-user message reads, notification prefs, channel creator, drop legacy share tables

Revision ID: 9c4e2a7b5d10
Revises: 8b2c4d9e1f03
Create Date: 2026-11-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '9c4e2a7b5d10'
down_revision: Union[str, None] = '8b2c4d9e1f03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _insp():
    return sa.inspect(op.get_bind())


def upgrade() -> None:
    insp = _insp()

    # notification_preferences used to be created only by create_all()
    if not insp.has_table('notification_preferences'):
        op.create_table(
            'notification_preferences',
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False),
            sa.Column('enable_messages', sa.Boolean(), nullable=False),
            sa.Column('enable_file_events', sa.Boolean(), nullable=False),
            sa.Column('enable_alerts', sa.Boolean(), nullable=False),
            sa.Column('min_alert_priority', sa.String(length=16), nullable=False),
            sa.Column('mute_channel_ids', sa.JSON(), nullable=False),
            sa.Column('mute_folder_paths', sa.JSON(), nullable=False),
            sa.Column('dnd_start', sa.String(length=5), nullable=False),
            sa.Column('dnd_end', sa.String(length=5), nullable=False),
            sa.Column('sound', sa.Boolean(), nullable=False),
            sa.Column('desktop_toast', sa.Boolean(), nullable=False),
            sa.Column('email_digest', sa.Boolean(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('user_id'),
        )

    if not insp.has_table('message_reads'):
        op.create_table(
            'message_reads',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('message_id', sa.Integer(), nullable=False),
            sa.Column('username', sa.String(length=64), nullable=False),
            sa.Column('read_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['message_id'], ['messages.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('message_id', 'username', name='uq_message_read'),
        )
        op.create_index(op.f('ix_message_reads_message_id'), 'message_reads', ['message_id'])
        op.create_index(op.f('ix_message_reads_username'), 'message_reads', ['username'])

    cols = {c['name'] for c in insp.get_columns('channels')}
    if 'created_by' not in cols:
        with op.batch_alter_table('channels') as b:
            b.add_column(sa.Column('created_by', sa.String(length=64), nullable=True))

    # Legacy share-a-folder model, superseded by root_config + folder_acl.
    for t in ('shared_folder_members', 'app_settings', 'shared_folders'):
        if insp.has_table(t):
            op.drop_table(t)


def downgrade() -> None:
    op.create_table(
        'shared_folders',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('path', sa.String(length=512), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('sync_enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('channels') as b:
        b.drop_column('created_by')
    op.drop_index(op.f('ix_message_reads_username'), table_name='message_reads')
    op.drop_index(op.f('ix_message_reads_message_id'), table_name='message_reads')
    op.drop_table('message_reads')
    op.drop_table('notification_preferences')
