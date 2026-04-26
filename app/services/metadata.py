from __future__ import annotations

import sqlite3
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from app.config import settings

try:
    from pymongo import MongoClient, ReturnDocument
except Exception:  # pragma: no cover
    MongoClient = None  # type: ignore[assignment]
    ReturnDocument = None  # type: ignore[assignment]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteMetadataStore:
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
                    is_visible INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            # Best-effort schema migration for older DBs.
            try:
                cols = {row["name"] for row in conn.execute("PRAGMA table_info(portfolio_projects)").fetchall()}
                if "source_logical_document_key" not in cols:
                    conn.execute("ALTER TABLE portfolio_projects ADD COLUMN source_logical_document_key TEXT")
                if "source_version_id" not in cols:
                    conn.execute("ALTER TABLE portfolio_projects ADD COLUMN source_version_id TEXT")
                if "what_it_does_json" not in cols:
                    conn.execute("ALTER TABLE portfolio_projects ADD COLUMN what_it_does_json TEXT NOT NULL DEFAULT '[]'")
                if "is_visible" not in cols:
                    conn.execute("ALTER TABLE portfolio_projects ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1")
            except Exception:
                pass
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
            # Default settings
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('open_to_work', 'true')")
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('current_location', 'India')")
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('desired_locations', '[]')")
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('profile_overrides', '{}')")
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('portfolio_experience', '[]')")
            conn.execute("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('portfolio_skills', '[]')")

    # ── Portfolio projects ──────────────────────────────────────────────────

    def list_portfolio_projects(self, include_hidden: bool = True) -> list[dict[str, Any]]:
        query = """
            SELECT project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                   source_logical_document_key, source_version_id, what_it_does_json, is_visible
            FROM portfolio_projects
            {where}
            ORDER BY sort_order ASC, updated_at DESC
        """.format(where="" if include_hidden else "WHERE is_visible = 1")
        with self.connect() as conn:
            rows = conn.execute(query).fetchall()
        projects: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            try:
                tech_stack = json.loads(item.get("tech_stack_json") or "[]")
            except Exception:
                tech_stack = []
            try:
                what_it_does = json.loads(item.get("what_it_does_json") or "[]")
            except Exception:
                what_it_does = []
            projects.append(
                {
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
                    "isVisible": bool(item.get("is_visible", 1)),
                }
            )
        return projects

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
        tech_payload = json.dumps(tech_stack or [])
        wid_payload = json.dumps(what_it_does or [])
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO portfolio_projects (
                    project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                    source_logical_document_key, source_version_id, what_it_does_json, is_visible
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(project_id) DO UPDATE SET
                    title = excluded.title,
                    summary = excluded.summary,
                    tech_stack_json = excluded.tech_stack_json,
                    source_path = excluded.source_path,
                    sort_order = excluded.sort_order,
                    updated_at = excluded.updated_at,
                    source_logical_document_key = excluded.source_logical_document_key,
                    source_version_id = excluded.source_version_id,
                    what_it_does_json = excluded.what_it_does_json,
                    is_visible = excluded.is_visible
                """,
                (
                    normalized_id,
                    title,
                    summary,
                    tech_payload,
                    source_path,
                    int(sort_order),
                    utc_now_iso(),
                    source_logical_document_key,
                    source_version_id,
                    wid_payload,
                    1 if is_visible else 0,
                ),
            )
        return normalized_id

    def delete_portfolio_project(self, project_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM portfolio_projects WHERE project_id = ?", (project_id,))

    def get_portfolio_project(self, project_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT project_id, title, summary, tech_stack_json, source_path, sort_order, updated_at,
                       source_logical_document_key, source_version_id, what_it_does_json, is_visible
                FROM portfolio_projects
                WHERE project_id = ?
                """,
                (project_id,),
            ).fetchone()
        if not row:
            return None
        item = dict(row)
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
            "whatItDoes": what_it_does if isinstance(what_it_does, list) else [],
            "isVisible": bool(item.get("is_visible", 1)),
            "sourceLogicalDocumentKey": item.get("source_logical_document_key") or None,
            "sourceVersionId": item.get("source_version_id") or None,
        }

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

    # ── Settings ──────────────────────────────────────────────────────────

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


class MongoMetadataStore:
    def __init__(self, mongo_uri: str, db_name: str) -> None:
        if not MongoClient:
            raise RuntimeError("pymongo is not installed, but MONGODB_URI is set.")
        self._client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
        self._db = self._client[db_name]
        self._versions = self._db["document_versions"]
        self._settings = self._db["app_settings"]
        self._projects = self._db["portfolio_projects"]

    def initialize(self) -> None:
        self._versions.create_index([("logical_document_key", 1), ("upload_timestamp", -1)])
        self._versions.create_index([("logical_document_key", 1), ("is_active", 1)])
        self._projects.create_index([("sort_order", 1), ("updated_at", -1)])
        # Default settings
        self._settings.update_one({"_id": "open_to_work"}, {"$setOnInsert": {"value": "true"}}, upsert=True)
        self._settings.update_one({"_id": "current_location"}, {"$setOnInsert": {"value": "India"}}, upsert=True)
        self._settings.update_one({"_id": "desired_locations"}, {"$setOnInsert": {"value": "[]"}}, upsert=True)
        self._settings.update_one({"_id": "profile_overrides"}, {"$setOnInsert": {"value": "{}"}}, upsert=True)
        self._settings.update_one({"_id": "portfolio_experience"}, {"$setOnInsert": {"value": "[]"}}, upsert=True)
        self._settings.update_one({"_id": "portfolio_skills"}, {"$setOnInsert": {"value": "[]"}}, upsert=True)
        self._migrate_from_sqlite_if_present()

    def _migrate_from_sqlite_if_present(self) -> None:
        """
        If the user already indexed documents while using SQLite, copy that metadata into Mongo
        so the admin/portfolio UI can still list documents and active versions.
        """
        try:
            if self._versions.estimated_document_count() > 0:
                return
        except Exception:
            return

        sqlite_path = settings.sqlite_path
        if not sqlite_path.exists():
            return

        try:
            connection = sqlite3.connect(sqlite_path)
            connection.row_factory = sqlite3.Row
        except Exception:
            return

        try:
            # Migrate app settings.
            try:
                setting_rows = connection.execute("SELECT key, value FROM app_settings").fetchall()
                for row in setting_rows:
                    key = str(row["key"])
                    value = str(row["value"])
                    self._settings.update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)
            except Exception:
                pass

            # Migrate document versions.
            version_rows = connection.execute("SELECT * FROM document_versions").fetchall()
            if not version_rows:
                return
            documents = []
            for row in version_rows:
                item = dict(row)
                version_id = str(item.get("version_id") or "")
                if not version_id:
                    continue
                item["_id"] = version_id
                item["is_active"] = bool(int(item.get("is_active") or 0))
                item["chunk_count"] = int(item.get("chunk_count") or 0)
                documents.append(item)
            if documents:
                self._versions.insert_many(documents, ordered=False)

            # Migrate manually added projects.
            try:
                project_rows = connection.execute("SELECT * FROM portfolio_projects").fetchall()
                project_docs = []
                for row in project_rows:
                    item = dict(row)
                    project_id = str(item.get("project_id") or "")
                    if not project_id:
                        continue
                    tech_stack_json = str(item.get("tech_stack_json") or "[]")
                    try:
                        tech_stack = json.loads(tech_stack_json)
                    except Exception:
                        tech_stack = []
                    try:
                        what_it_does = json.loads(str(item.get("what_it_does_json") or "[]"))
                    except Exception:
                        what_it_does = []
                    project_docs.append(
                        {
                            "_id": project_id,
                            "title": str(item.get("title") or ""),
                            "summary": str(item.get("summary") or ""),
                            "tech_stack": tech_stack if isinstance(tech_stack, list) else [],
                            "source_path": str(item.get("source_path") or "Admin"),
                            "sort_order": int(item.get("sort_order") or 0),
                            "updated_at": str(item.get("updated_at") or utc_now_iso()),
                            "what_it_does": what_it_does if isinstance(what_it_does, list) else [],
                            "is_visible": bool(int(item.get("is_visible", 1))),
                        }
                    )
                if project_docs:
                    self._projects.insert_many(project_docs, ordered=False)
            except Exception:
                pass
        finally:
            try:
                connection.close()
            except Exception:
                pass

    def create_version(
        self,
        logical_document_key: str,
        file_name: str,
        file_type: str,
        storage_path: str,
        source_label: str | None,
    ) -> str:
        version_id = str(uuid.uuid4())
        document = {
            "_id": version_id,
            "logical_document_key": logical_document_key,
            "version_id": version_id,
            "file_name": file_name,
            "file_type": file_type,
            "storage_path": storage_path,
            "upload_timestamp": utc_now_iso(),
            "status": "uploaded",
            "is_active": False,
            "source_label": source_label,
            "chunk_count": 0,
            "parse_artifact_path": None,
        }
        self._versions.insert_one(document)
        return version_id

    def get_version(self, version_id: str) -> dict[str, Any] | None:
        row = self._versions.find_one({"_id": version_id})
        if not row:
            return None
        row.pop("_id", None)
        return dict(row)

    def list_documents(self) -> list[dict[str, Any]]:
        rows = list(self._versions.find({}).sort([("logical_document_key", 1), ("upload_timestamp", -1)]))
        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            item = dict(row)
            item.pop("_id", None)
            key = str(item["logical_document_key"])
            summary = grouped.setdefault(
                key,
                {
                    "logical_document_key": key,
                    "active_version_id": None,
                    "updated_at": item["upload_timestamp"],
                    "versions": [],
                },
            )
            if item.get("is_active"):
                summary["active_version_id"] = item["version_id"]
            summary["versions"].append(item)
        return list(grouped.values())

    def list_versions(self, logical_document_key: str) -> list[dict[str, Any]]:
        rows = list(
            self._versions.find({"logical_document_key": logical_document_key}).sort([("upload_timestamp", -1)])
        )
        results: list[dict[str, Any]] = []
        for row in rows:
            row = dict(row)
            row.pop("_id", None)
            results.append(row)
        return results

    def update_status(
        self,
        version_id: str,
        status: str,
        chunk_count: int | None = None,
        parse_artifact_path: str | None = None,
    ) -> None:
        current = self._versions.find_one({"_id": version_id})
        if not current:
            raise ValueError(f"Unknown version_id: {version_id}")
        next_chunk_count = int(current.get("chunk_count", 0)) if chunk_count is None else int(chunk_count)
        next_parse_path = current.get("parse_artifact_path") if parse_artifact_path is None else parse_artifact_path
        self._versions.update_one(
            {"_id": version_id},
            {"$set": {"status": status, "chunk_count": next_chunk_count, "parse_artifact_path": next_parse_path}},
        )

    def update_storage_path(self, version_id: str, storage_path: str) -> None:
        self._versions.update_one({"_id": version_id}, {"$set": {"storage_path": storage_path}})

    def activate_version(self, logical_document_key: str, version_id: str) -> None:
        self._versions.update_many({"logical_document_key": logical_document_key}, {"$set": {"is_active": False}})
        self._versions.update_one(
            {"_id": version_id},
            {"$set": {"is_active": True, "status": "indexed"}},
        )

    # ── Settings ──────────────────────────────────────────────────────────

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self._settings.find_one({"_id": key})
        if not row:
            return default
        return str(row.get("value", default))

    def set_setting(self, key: str, value: str) -> None:
        self._settings.update_one({"_id": key}, {"$set": {"value": value}}, upsert=True)

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

    # ── Portfolio projects ──────────────────────────────────────────────────

    def list_portfolio_projects(self, include_hidden: bool = True) -> list[dict[str, Any]]:
        query_filter = {} if include_hidden else {"is_visible": {"$ne": False}}
        rows = list(self._projects.find(query_filter).sort([("sort_order", 1), ("updated_at", -1)]))
        projects: list[dict[str, Any]] = []
        for row in rows:
            project_id = str(row.get("_id") or row.get("project_id") or "")
            if not project_id:
                continue
            projects.append(
                {
                    "id": project_id,
                    "title": str(row.get("title") or ""),
                    "summary": str(row.get("summary") or ""),
                    "techStack": list(row.get("tech_stack") or []),
                    "sourcePath": str(row.get("source_path") or "Admin"),
                    "sortOrder": int(row.get("sort_order") or 0),
                    "updatedAt": str(row.get("updated_at") or ""),
                    "whatItDoes": list(row.get("what_it_does") or []),
                    "isVisible": bool(row.get("is_visible", True)),
                    "sourceLogicalDocumentKey": row.get("source_logical_document_key") or None,
                    "sourceVersionId": row.get("source_version_id") or None,
                }
            )
        return projects

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
        now = utc_now_iso()
        self._projects.update_one(
            {"_id": normalized_id},
            {
                "$set": {
                    "title": title,
                    "summary": summary,
                    "tech_stack": tech_stack or [],
                    "source_path": source_path,
                    "sort_order": int(sort_order or 0),
                    "updated_at": now,
                    "what_it_does": what_it_does or [],
                    "is_visible": is_visible,
                    "source_logical_document_key": source_logical_document_key,
                    "source_version_id": source_version_id,
                }
            },
            upsert=True,
        )
        return normalized_id

    def delete_portfolio_project(self, project_id: str) -> None:
        self._projects.delete_one({"_id": project_id})

    def get_portfolio_project(self, project_id: str) -> dict[str, Any] | None:
        row = self._projects.find_one({"_id": project_id})
        if not row:
            return None
        return {
            "id": str(row.get("_id") or ""),
            "title": str(row.get("title") or ""),
            "summary": str(row.get("summary") or ""),
            "techStack": list(row.get("tech_stack") or []),
            "sourcePath": str(row.get("source_path") or "Admin"),
            "sortOrder": int(row.get("sort_order") or 0),
            "updatedAt": str(row.get("updated_at") or ""),
            "whatItDoes": list(row.get("what_it_does") or []),
            "isVisible": bool(row.get("is_visible", True)),
            "sourceLogicalDocumentKey": row.get("source_logical_document_key") or None,
            "sourceVersionId": row.get("source_version_id") or None,
        }


metadata_store = (
    MongoMetadataStore(settings.mongodb_uri, settings.mongodb_db)
    if settings.mongodb_uri
    else SqliteMetadataStore(settings.sqlite_path)
)
