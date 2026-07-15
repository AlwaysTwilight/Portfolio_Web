from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.services.db import connection, cursor


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostgresMetadataStore:
    """Postgres-backed metadata store. Mirrors SqliteMetadataStore's interface."""

    def initialize(self) -> None:
        with connection() as conn:
            with conn.transaction():
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
                        is_active BOOLEAN NOT NULL DEFAULT FALSE,
                        source_label TEXT,
                        chunk_count INTEGER NOT NULL DEFAULT 0,
                        parse_artifact_path TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS portfolio_projects (
                        project_id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        tech_stack_json TEXT NOT NULL,
                        source_path TEXT NOT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        updated_at TEXT NOT NULL,
                        source_logical_document_key TEXT,
                        source_version_id TEXT,
                        what_it_does_json TEXT NOT NULL DEFAULT '[]',
                        is_visible BOOLEAN NOT NULL DEFAULT TRUE
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
                    CREATE TABLE IF NOT EXISTS contact_messages (
                        message_id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT NOT NULL,
                        message TEXT NOT NULL,
                        source TEXT NOT NULL DEFAULT 'form',
                        is_read BOOLEAN NOT NULL DEFAULT FALSE,
                        created_at TEXT NOT NULL
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
                    CREATE INDEX IF NOT EXISTS idx_contact_messages_created
                    ON contact_messages (created_at DESC)
                    """
                )
                defaults = {
                    "open_to_work": "true",
                    "current_location": "India",
                    "desired_locations": "[]",
                    "profile_overrides": "{}",
                    "portfolio_experience": "[]",
                    "portfolio_skills": "[]",
                    "social_links": json.dumps({
                        "linkedin": "https://www.linkedin.com/in/raj-sahoo-624439253/",
                        "github": "https://github.com/AlwaysTwilight",
                        "email": "rs1092002@gmail.com",
                    }),
                    "scheduling": json.dumps({
                        "calLink": "",
                        "enabled": False,
                        "headline": "Let's talk",
                        "subtext": "Book a 30-minute call — pick a time that works and you'll get a Google Meet link automatically.",
                    }),
                }
                for key, value in defaults.items():
                    conn.execute(
                        "INSERT INTO app_settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO NOTHING",
                        (key, value),
                    )

    # ── Portfolio projects ──────────────────────────────────────────────────

    def list_portfolio_projects(self, include_hidden: bool = True) -> list[dict[str, Any]]:
        where = "" if include_hidden else "WHERE is_visible = TRUE"
        with cursor() as cur:
            cur.execute(
                f"""
                SELECT project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                       source_logical_document_key, source_version_id, what_it_does_json, is_visible
                FROM portfolio_projects
                {where}
                ORDER BY sort_order ASC, updated_at DESC
                """
            )
            rows = cur.fetchall()
        return [self._project_row_to_payload(row) for row in rows]

    def _project_row_to_payload(self, item: dict[str, Any]) -> dict[str, Any]:
        try:
            tech_stack = json.loads(item.get("tech_stack_json") or "[]")
        except Exception:
            tech_stack = []
        try:
            what_it_does = json.loads(item.get("what_it_does_json") or "[]")
        except Exception:
            what_it_does = []
        return {
            "id": item["project_id"],
            "title": item["title"],
            "summary": item["summary"],
            "techStack": tech_stack if isinstance(tech_stack, list) else [],
            "sourcePath": item["source_path"],
            "sortOrder": int(item.get("sort_order") or 0),
            "updatedAt": item["updated_at"],
            "sourceLogicalDocumentKey": item.get("source_logical_document_key") or None,
            "sourceVersionId": item.get("source_version_id") or None,
            "whatItDoes": what_it_does if isinstance(what_it_does, list) else [],
            "isVisible": bool(item.get("is_visible", True)),
        }

    def upsert_portfolio_project(
        self,
        *,
        project_id: str | None,
        title: str,
        summary: str,
        tech_stack: list[str],
        source_path: str = "Admin",
        sort_order: int = 0,
        what_it_does: list[str] | None = None,
        is_visible: bool = True,
        source_logical_document_key: str | None = None,
        source_version_id: str | None = None,
    ) -> str:
        normalized_id = project_id or str(uuid.uuid4())
        with connection() as conn:
            conn.execute(
                """
                INSERT INTO portfolio_projects (
                    project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                    source_logical_document_key, source_version_id, what_it_does_json, is_visible
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    summary = EXCLUDED.summary,
                    tech_stack_json = EXCLUDED.tech_stack_json,
                    source_path = EXCLUDED.source_path,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = EXCLUDED.updated_at,
                    source_logical_document_key = EXCLUDED.source_logical_document_key,
                    source_version_id = EXCLUDED.source_version_id,
                    what_it_does_json = EXCLUDED.what_it_does_json,
                    is_visible = EXCLUDED.is_visible
                """,
                (
                    normalized_id,
                    title,
                    summary,
                    json.dumps(tech_stack or []),
                    source_path,
                    int(sort_order),
                    utc_now_iso(),
                    source_logical_document_key,
                    source_version_id,
                    json.dumps(what_it_does or []),
                    bool(is_visible),
                ),
            )
        return normalized_id

    def delete_portfolio_project(self, project_id: str) -> None:
        with connection() as conn:
            conn.execute("DELETE FROM portfolio_projects WHERE project_id = %s", (project_id,))

    def get_portfolio_project(self, project_id: str) -> dict[str, Any] | None:
        with cursor() as cur:
            cur.execute(
                """
                SELECT project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                       source_logical_document_key, source_version_id, what_it_does_json, is_visible
                FROM portfolio_projects
                WHERE project_id = %s
                """,
                (project_id,),
            )
            row = cur.fetchone()
        return self._project_row_to_payload(row) if row else None

    # ── Document versions ──────────────────────────────────────────────────

    def create_version(
        self,
        logical_document_key: str,
        file_name: str,
        file_type: str,
        storage_path: str,
        source_label: str | None,
    ) -> str:
        version_id = str(uuid.uuid4())
        with connection() as conn:
            conn.execute(
                """
                INSERT INTO document_versions (
                    logical_document_key, version_id, file_name, file_type, storage_path,
                    upload_timestamp, status, is_active, source_label, chunk_count, parse_artifact_path
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, %s, 0, NULL)
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
        with cursor() as cur:
            cur.execute("SELECT * FROM document_versions WHERE version_id = %s", (version_id,))
            row = cur.fetchone()
        return dict(row) if row else None

    def list_documents(self) -> list[dict[str, Any]]:
        with cursor() as cur:
            cur.execute(
                "SELECT * FROM document_versions ORDER BY logical_document_key, upload_timestamp DESC"
            )
            rows = cur.fetchall()
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
        with cursor() as cur:
            cur.execute(
                """
                SELECT * FROM document_versions
                WHERE logical_document_key = %s
                ORDER BY upload_timestamp DESC
                """,
                (logical_document_key,),
            )
            rows = cur.fetchall()
        return [dict(row) for row in rows]

    def update_status(
        self,
        version_id: str,
        status: str,
        chunk_count: int | None = None,
        parse_artifact_path: str | None = None,
    ) -> None:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT chunk_count, parse_artifact_path FROM document_versions WHERE version_id = %s",
                    (version_id,),
                )
                current = cur.fetchone()
            if not current:
                raise ValueError(f"Unknown version_id: {version_id}")
            conn.execute(
                """
                UPDATE document_versions
                SET status = %s, chunk_count = %s, parse_artifact_path = %s
                WHERE version_id = %s
                """,
                (
                    status,
                    current[0] if chunk_count is None else chunk_count,
                    current[1] if parse_artifact_path is None else parse_artifact_path,
                    version_id,
                ),
            )

    def update_storage_path(self, version_id: str, storage_path: str) -> None:
        with connection() as conn:
            conn.execute(
                "UPDATE document_versions SET storage_path = %s WHERE version_id = %s",
                (storage_path, version_id),
            )

    def activate_version(self, logical_document_key: str, version_id: str) -> None:
        with connection() as conn:
            with conn.transaction():
                conn.execute(
                    "UPDATE document_versions SET is_active = FALSE WHERE logical_document_key = %s",
                    (logical_document_key,),
                )
                conn.execute(
                    "UPDATE document_versions SET is_active = TRUE, status = %s WHERE version_id = %s",
                    ("indexed", version_id),
                )

    # ── Settings ──────────────────────────────────────────────────────────

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        with cursor(dict_rows=False) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = %s", (key,))
            row = cur.fetchone()
        return str(row[0]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        with connection() as conn:
            conn.execute(
                """
                INSERT INTO app_settings (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """,
                (key, value),
            )

    def get_open_to_work(self) -> bool:
        return (self.get_setting("open_to_work", "true") or "true").lower() == "true"

    def set_open_to_work(self, value: bool) -> None:
        self.set_setting("open_to_work", "true" if value else "false")

    def get_current_location(self) -> str:
        return self.get_setting("current_location", "India") or "India"

    def set_current_location(self, value: str) -> None:
        self.set_setting("current_location", value.strip())

    def get_desired_locations(self) -> list[str]:
        raw = self.get_setting("desired_locations", "[]") or "[]"
        try:
            result = json.loads(raw)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def set_desired_locations(self, locations: list[str]) -> None:
        self.set_setting("desired_locations", json.dumps([loc.strip() for loc in locations if loc.strip()]))

    def get_profile_overrides(self) -> dict[str, Any]:
        raw = self.get_setting("profile_overrides", "{}") or "{}"
        try:
            result = json.loads(raw)
            return result if isinstance(result, dict) else {}
        except Exception:
            return {}

    def set_profile_overrides(self, value: dict[str, Any]) -> None:
        allowed = {"name", "location", "headline", "about", "eyebrow"}
        payload = {key: str(value.get(key) or "").strip() for key in allowed if str(value.get(key) or "").strip()}
        self.set_setting("profile_overrides", json.dumps(payload))

    def get_portfolio_experience(self) -> list[dict[str, Any]]:
        raw = self.get_setting("portfolio_experience", "[]") or "[]"
        try:
            result = json.loads(raw)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def set_portfolio_experience(self, value: list[dict[str, Any]]) -> None:
        self.set_setting("portfolio_experience", json.dumps(value))

    def get_portfolio_skills(self) -> list[dict[str, Any]]:
        raw = self.get_setting("portfolio_skills", "[]") or "[]"
        try:
            result = json.loads(raw)
            return result if isinstance(result, list) else []
        except Exception:
            return []

    def set_portfolio_skills(self, value: list[dict[str, Any]]) -> None:
        self.set_setting("portfolio_skills", json.dumps(value))

    def get_social_links(self) -> dict[str, str]:
        raw = self.get_setting("social_links", "{}") or "{}"
        try:
            result = json.loads(raw)
            return result if isinstance(result, dict) else {}
        except Exception:
            return {}

    def set_social_links(self, value: dict[str, str]) -> None:
        allowed = {"linkedin", "github", "email"}
        payload = {k: str(v).strip() for k, v in value.items() if k in allowed}
        self.set_setting("social_links", json.dumps(payload))

    def get_scheduling(self) -> dict[str, Any]:
        raw = self.get_setting("scheduling", "{}") or "{}"
        try:
            result = json.loads(raw)
            return result if isinstance(result, dict) else {}
        except Exception:
            return {}

    def set_scheduling(self, value: dict[str, Any]) -> None:
        payload = {
            "calLink": str(value.get("calLink") or "").strip(),
            "enabled": bool(value.get("enabled")),
            "headline": str(value.get("headline") or "").strip() or "Let's talk",
            "subtext": str(value.get("subtext") or "").strip(),
        }
        self.set_setting("scheduling", json.dumps(payload))

    # ── Contact messages ────────────────────────────────────────────────────

    def create_contact_message(self, name: str, email: str, message: str, source: str = "form") -> dict[str, Any]:
        message_id = str(uuid.uuid4())
        created_at = utc_now_iso()
        with connection() as conn:
            conn.execute(
                """
                INSERT INTO contact_messages (message_id, name, email, message, source, is_read, created_at)
                VALUES (%s, %s, %s, %s, %s, FALSE, %s)
                """,
                (message_id, name.strip(), email.strip(), message.strip(), source, created_at),
            )
        return {
            "message_id": message_id,
            "name": name.strip(),
            "email": email.strip(),
            "message": message.strip(),
            "source": source,
            "is_read": False,
            "created_at": created_at,
        }

    def list_contact_messages(self, limit: int = 200) -> list[dict[str, Any]]:
        with cursor() as cur:
            cur.execute(
                """
                SELECT message_id, name, email, message, source, is_read, created_at
                FROM contact_messages
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(row) for row in cur.fetchall()]

    def mark_contact_message_read(self, message_id: str, is_read: bool = True) -> None:
        with connection() as conn:
            conn.execute(
                "UPDATE contact_messages SET is_read = %s WHERE message_id = %s",
                (is_read, message_id),
            )

    def delete_contact_message(self, message_id: str) -> None:
        with connection() as conn:
            conn.execute("DELETE FROM contact_messages WHERE message_id = %s", (message_id,))
