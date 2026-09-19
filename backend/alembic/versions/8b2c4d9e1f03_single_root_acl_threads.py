"""single root + folder acl + file threads

Revision ID: 8b2c4d9e1f03
Revises: 7a3079121474
Create Date: 2026-09-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '8b2c4d9e1f03'
down_revision: Union[str, None] = '7a3079121474'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'root_config',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('path', sa.String(length=1024), nullable=False),
        sa.Column('updated_by', sa.String(length=64), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'folder_acl',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('subfolder', sa.String(length=512), nullable=False),
        sa.Column('members', sa.JSON(), nullable=False),
        sa.Column('updated_by', sa.String(length=64), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_folder_acl_subfolder'), 'folder_acl', ['subfolder'], unique=True)
    op.create_table(
        'file_threads',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('file_path', sa.String(length=512), nullable=False),
        sa.Column('created_by', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_file_threads_file_path'), 'file_threads', ['file_path'], unique=True)
    op.create_table(
        'file_comments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('thread_id', sa.Integer(), nullable=False),
        sa.Column('sender', sa.String(length=64), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['thread_id'], ['file_threads.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_file_comments_thread_id'), 'file_comments', ['thread_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_file_comments_thread_id'), table_name='file_comments')
    op.drop_table('file_comments')
    op.drop_index(op.f('ix_file_threads_file_path'), table_name='file_threads')
    op.drop_table('file_threads')
    op.drop_index(op.f('ix_folder_acl_subfolder'), table_name='folder_acl')
    op.drop_table('folder_acl')
    op.drop_table('root_config')
