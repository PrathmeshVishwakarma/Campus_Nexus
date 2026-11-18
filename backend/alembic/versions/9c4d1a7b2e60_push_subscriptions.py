"""push subscriptions

Revision ID: 9c4d1a7b2e60
Revises: 8b2c4d9e1f03
Create Date: 2026-11-17
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "9c4d1a7b2e60"
down_revision: Union[str, None] = "8b2c4d9e1f03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("endpoint", sa.String(length=1024), nullable=False),
        sa.Column("p256dh", sa.String(length=256), nullable=False),
        sa.Column("auth", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_push_subscriptions_username", "push_subscriptions", ["username"])
    op.create_index("ix_push_subscriptions_endpoint", "push_subscriptions", ["endpoint"],
                    unique=True)


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_endpoint", table_name="push_subscriptions")
    op.drop_index("ix_push_subscriptions_username", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
