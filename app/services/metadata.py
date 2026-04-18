from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MetadataStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS document_versions (
                    logical_document_key TEXT NOT NULL,
                    version_id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    upload_timestamp TEXT NOT NULL,
                    status TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 0,
                    source_label TEXT,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    parse_artifact_path TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_document_versions_key
                ON document_versions (logical_document_key, upload_timestamp DESC)
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO app_settings (key, value)
                VALUES ('open_to_work', 'true')
                """
            )

    def create_version(
        self,
        logical_document_key: str,
        file_name: str,
        file_type: str,
        storage_path: str,
        source_label: str | None,
    ) -> str:
        version_id = str(uuid.uuid4())
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO document_versions (
                    logical_document_key, version_id, file_name, file_type, storage_path,
                    upload_timestamp, status, is_active, source_label, chunk_count, parse_artifact_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, NULL)
                """,
                (
                    logical_document_key,
                    version_id,
                    file_name,
                    file_type,
                    storage_path,
                    utc_now_iso(),
                    "uploaded",
                    source_label,
                ),
            )
        return version_id

    def get_version(self, version_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM document_versions WHERE version_id = ?",
                (version_id,),
            ).fetchone()
        return dict(row) if row else None

    def list_documents(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM document_versions ORDER BY logical_document_key, upload_timestamp DESC"
            ).fetchall()

        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            item = dict(row)
            key = item["logical_document_key"]
            summary = grouped.setdefault(
                key,
                {
                    "logical_document_key": key,
                    "active_version_id": None,
                    "updated_at": item["upload_timestamp"],
                    "versions": [],
                },
            )
            if item["is_active"]:
                summary["active_version_id"] = item["version_id"]
            summary["versions"].append(item)
        return list(grouped.values())

    def list_versions(self, logical_document_key: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM document_versions
                WHERE logical_document_key = ?
                ORDER BY upload_timestamp DESC
                """,
                (logical_document_key,),
            ).fetchall()
        return [dict(row) for row in rows]

    def update_status(
        self,
        version_id: str,
        status: str,
        chunk_count: int | None = None,
        parse_artifact_path: str | None = None,
    ) -> None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT chunk_count, parse_artifact_path FROM document_versions WHERE version_id = ?",
                (version_id,),
            ).fetchone()
            current = dict(row) if row else None
            if not current:
                raise ValueError(f"Unknown version_id: {version_id}")
            conn.execute(
                """
                UPDATE document_versions
                SET status = ?, chunk_count = ?, parse_artifact_path = ?
                WHERE version_id = ?
                """,
                (
                    status,
                    current["chunk_count"] if chunk_count is None else chunk_count,
                    current["parse_artifact_path"] if parse_artifact_path is None else parse_artifact_path,
                    version_id,
                ),
            )

    def update_storage_path(self, version_id: str, storage_path: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE document_versions SET storage_path = ? WHERE version_id = ?",
                (storage_path, version_id),
            )

    def activate_version(self, logical_document_key: str, version_id: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE document_versions SET is_active = 0 WHERE logical_document_key = ?",
                (logical_document_key,),
            )
            conn.execute(
                "UPDATE document_versions SET is_active = 1, status = ? WHERE version_id = ?",
                ("indexed", version_id),
            )

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        if not row:
            return default
        return str(row["value"])

    def set_setting(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value)
                VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, value),
            )

    def get_open_to_work(self) -> bool:
        return (self.get_setting("open_to_work", "true") or "true").lower() == "true"

    def set_open_to_work(self, value: bool) -> None:
        self.set_setting("open_to_work", "true" if value else "false")


metadata_store = MetadataStore(settings.sqlite_path)
