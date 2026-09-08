"""Alembic environment.

Reads the URL from app.config.settings rather than alembic.ini, so migrations
and the running application can never point at different databases — the
failure mode where a migration "succeeded" against the wrong DB is silent and
expensive.
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db.models import Base  # noqa: E402

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    """Keep TimescaleDB's own objects out of autogenerate.

    `telemetry` is a hypertable: Timescale creates indexes and chunk tables we
    never declared, so autogenerate sees them as drift and proposes dropping
    them. Doing that silently degrades every time-range query. Anything
    reflected-but-undeclared on the hypertable is left alone.
    """
    if type_ == "index" and reflected and compare_to is None:
        if name and name.startswith("telemetry_"):
            return False
    if type_ == "table" and name.startswith(("_hyper_", "_timescaledb")):
        return False
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_object,
            # telemetry is a TimescaleDB hypertable; its chunks live in an
            # internal schema that autogenerate would otherwise try to "drop".
            include_schemas=False,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
