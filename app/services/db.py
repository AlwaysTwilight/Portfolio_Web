from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from psycopg import Connection, Cursor
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pgvector.psycopg import register_vector

from app.config import settings


_pool: ConnectionPool | None = None


def _configure(conn: Connection) -> None:
    # The vector type must exist before pgvector can register its adapters.
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is not configured.")
        # open=False so startup never blocks waiting for Neon to wake up.
        # Connections are made lazily on first request.
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=0,
            max_size=5,
            kwargs={"autocommit": True, "connect_timeout": 15},
            configure=_configure,
            open=False,
        )
        _pool.open(wait=False)
    return _pool


@contextmanager
def connection() -> Iterator[Connection]:
    with get_pool().connection() as conn:
        yield conn


@contextmanager
def cursor(*, dict_rows: bool = True) -> Iterator[Cursor]:
    with get_pool().connection() as conn:
        with conn.cursor(row_factory=dict_row if dict_rows else None) as cur:
            yield cur
