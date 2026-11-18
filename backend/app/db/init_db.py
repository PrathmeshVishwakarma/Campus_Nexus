"""Bring the database schema to the latest Alembic revision on startup.

Alembic is the single owner of the schema. Databases created by older builds
via ``Base.metadata.create_all()`` have tables but no (or a stale)
``alembic_version``; they are stamped at the initial revision and upgraded — the
later migrations skip tables that already exist.
"""

import logging
from pathlib import Path

import sqlalchemy as sa
from alembic import command
from alembic.config import Config

from app.core.config import BACKEND_DIR, settings
from app.db.session import engine

log = logging.getLogger("campus_nexus.db")
INITIAL_REVISION = "7a3079121474"


def _alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(BACKEND_DIR) / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    # keep alembic from reconfiguring the app's logging
    cfg.attributes["configure_logger"] = False
    return cfg


def init_db() -> None:
    cfg = _alembic_config()
    insp = sa.inspect(engine)
    tables = set(insp.get_table_names())
    if "users" in tables and "alembic_version" not in tables:
        log.info("Existing schema without alembic_version: stamping %s", INITIAL_REVISION)
        command.stamp(cfg, INITIAL_REVISION)
    command.upgrade(cfg, "head")
