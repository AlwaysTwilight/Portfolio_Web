from __future__ import annotations

from typing import Any

from psycopg.types.json import Jsonb

from app.config import settings
from app.services.db import connection, cursor


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(repr(float(value)) for value in embedding) + "]"


class PgVectorStore:
    """Drop-in replacement for the Chroma-backed VectorStore, backed by Postgres + pgvector.

    Method signatures and return shapes mirror the Chroma client so that chat,
    ingestion, and portfolio services do not need to change.
    """

    def __init__(self) -> None:
        self._schema_ready = False

    def _ensure_schema(self) -> None:
        if self._schema_ready:
            return
        dim = int(settings.gemini_embedding_dim)
        with connection() as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS rag_chunks (
                    id TEXT PRIMARY KEY,
                    collection TEXT NOT NULL,
                    logical_document_key TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    chunk_index INTEGER NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    document TEXT NOT NULL,
                    embedding vector({dim}),
                    metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_chunks_active ON rag_chunks (collection, is_active)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc ON rag_chunks (logical_document_key, version_id)"
            )
        self._schema_ready = True

    def count(self, collection_name: str) -> int:
        self._ensure_schema()
        with cursor(dict_rows=False) as cur:
            cur.execute("SELECT count(*) FROM rag_chunks WHERE collection = %s", (collection_name,))
            row = cur.fetchone()
        return int(row[0]) if row else 0

    def upsert_chunks(
        self,
        collection_name: str,
        ids: list[str],
        documents: list[str],
        embeddings: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None:
        self._ensure_schema()
        with connection() as conn:
            with conn.transaction():
                for chunk_id, document, embedding, metadata in zip(ids, documents, embeddings, metadatas):
                    conn.execute(
                        """
                        INSERT INTO rag_chunks (
                            id, collection, logical_document_key, version_id, chunk_index,
                            is_active, document, embedding, metadata
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            collection = EXCLUDED.collection,
                            logical_document_key = EXCLUDED.logical_document_key,
                            version_id = EXCLUDED.version_id,
                            chunk_index = EXCLUDED.chunk_index,
                            is_active = EXCLUDED.is_active,
                            document = EXCLUDED.document,
                            embedding = EXCLUDED.embedding,
                            metadata = EXCLUDED.metadata
                        """,
                        (
                            str(chunk_id),
                            collection_name,
                            str(metadata.get("logical_document_key") or ""),
                            str(metadata.get("version_id") or ""),
                            int(metadata.get("chunk_index") or 0),
                            bool(metadata.get("is_active", True)),
                            str(document),
                            _vector_literal(embedding),
                            Jsonb(metadata),
                        ),
                    )

    def deactivate_logical_document(self, collection_name: str, logical_document_key: str) -> None:
        self._ensure_schema()
        with connection() as conn:
            conn.execute(
                "UPDATE rag_chunks SET is_active = FALSE WHERE collection = %s AND logical_document_key = %s",
                (collection_name, logical_document_key),
            )

    def search_active(self, collection_name: str, query_embedding: list[float], top_k: int) -> dict[str, Any]:
        self._ensure_schema()
        with cursor() as cur:
            cur.execute(
                """
                SELECT id, document, metadata, (embedding <=> %s::vector) AS distance
                FROM rag_chunks
                WHERE collection = %s AND is_active = TRUE
                ORDER BY distance
                LIMIT %s
                """,
                (_vector_literal(query_embedding), collection_name, int(top_k)),
            )
            rows = cur.fetchall()
        return {
            "ids": [[row["id"] for row in rows]],
            "documents": [[row["document"] for row in rows]],
            "metadatas": [[row["metadata"] for row in rows]],
            "distances": [[float(row["distance"]) for row in rows]],
        }

    def get_active_document_chunks(self, collection_name: str, logical_document_key: str, version_id: str) -> dict[str, Any]:
        self._ensure_schema()
        with cursor() as cur:
            cur.execute(
                """
                SELECT id, document, metadata
                FROM rag_chunks
                WHERE collection = %s AND is_active = TRUE
                  AND logical_document_key = %s AND version_id = %s
                ORDER BY chunk_index
                """,
                (collection_name, logical_document_key, version_id),
            )
            rows = cur.fetchall()
        return {
            "ids": [row["id"] for row in rows],
            "documents": [row["document"] for row in rows],
            "metadatas": [row["metadata"] for row in rows],
        }

    def list_active_documents(self, collection_name: str) -> list[dict[str, Any]]:
        self._ensure_schema()
        with cursor() as cur:
            cur.execute(
                """
                SELECT logical_document_key,
                       version_id,
                       max(metadata->>'file_name') AS file_name,
                       max(metadata->>'source_label') AS source_label,
                       count(*) AS chunk_count
                FROM rag_chunks
                WHERE collection = %s AND is_active = TRUE
                GROUP BY logical_document_key, version_id
                ORDER BY logical_document_key, version_id
                """,
                (collection_name,),
            )
            rows = cur.fetchall()
        return [
            {
                "logical_document_key": row["logical_document_key"],
                "version_id": row["version_id"],
                "file_name": row["file_name"] or "",
                "source_label": row["source_label"] or "",
                "chunk_count": int(row["chunk_count"] or 0),
            }
            for row in rows
        ]


pgvector_store = PgVectorStore()
