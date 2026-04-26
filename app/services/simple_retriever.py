from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.metadata import metadata_store


TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "does", "for", "from", "has", "have",
    "he", "how", "in", "is", "it", "of", "on", "or", "she", "tell", "that", "the", "their",
    "there", "they", "this", "to", "what", "when", "where", "which", "who", "why", "with",
    "about", "me", "please", "did", "work", "worked",
}


def tokenize(value: str) -> list[str]:
    return [token for token in TOKEN_RE.findall(value.lower()) if len(token) > 2 and token not in STOP_WORDS]


class SimpleRetriever:
    def chunks_path(self, logical_document_key: str, version_id: str) -> Path:
        return settings.processed_dir / logical_document_key / version_id / "chunks.json"

    def write_chunks(self, logical_document_key: str, version_id: str, chunks: list[dict[str, Any]]) -> Path:
        path = self.chunks_path(logical_document_key, version_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(chunks, indent=2), encoding="utf-8")
        return path

    def read_chunks(self, logical_document_key: str, version_id: str) -> list[dict[str, Any]]:
        path = self.chunks_path(logical_document_key, version_id)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        return payload if isinstance(payload, list) else []

    def active_documents(self) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        for summary in metadata_store.list_documents():
            active_version_id = summary.get("active_version_id")
            if not active_version_id:
                continue
            version = next(
                (
                    item for item in summary.get("versions", [])
                    if item.get("version_id") == active_version_id
                ),
                None,
            )
            if not version:
                continue
            chunk_count = len(self.read_chunks(str(summary["logical_document_key"]), str(active_version_id)))
            documents.append(
                {
                    "logical_document_key": str(summary["logical_document_key"]),
                    "version_id": str(active_version_id),
                    "file_name": str(version.get("file_name") or ""),
                    "source_label": str(version.get("source_label") or ""),
                    "chunk_count": chunk_count or int(version.get("chunk_count") or 0),
                }
            )
        return documents

    def _load_active_chunks(self) -> list[dict[str, Any]]:
        chunks: list[dict[str, Any]] = []
        for summary in metadata_store.list_documents():
            active_version_id = summary.get("active_version_id")
            if not active_version_id:
                continue
            chunks.extend(self.read_chunks(str(summary["logical_document_key"]), str(active_version_id)))
        return chunks

    def search(self, query: str, top_k: int) -> list[dict[str, Any]]:
        chunks = self._load_active_chunks()
        if not chunks:
            return []

        query_terms = tokenize(query)
        if not query_terms:
            return chunks[:top_k]

        document_frequencies: dict[str, int] = {}
        tokenized_chunks: list[list[str]] = []
        for chunk in chunks:
            tokens = tokenize(str(chunk.get("document") or ""))
            tokenized_chunks.append(tokens)
            for token in set(tokens):
                document_frequencies[token] = document_frequencies.get(token, 0) + 1

        average_length = sum(len(tokens) for tokens in tokenized_chunks) / max(len(tokenized_chunks), 1)
        total_chunks = len(chunks)
        ranked: list[dict[str, Any]] = []
        for chunk, tokens in zip(chunks, tokenized_chunks):
            token_counts: dict[str, int] = {}
            for token in tokens:
                token_counts[token] = token_counts.get(token, 0) + 1

            score = 0.0
            for term in query_terms:
                frequency = token_counts.get(term, 0)
                if not frequency:
                    continue
                idf = math.log(1 + (total_chunks - document_frequencies.get(term, 0) + 0.5) / (document_frequencies.get(term, 0) + 0.5))
                score += idf * ((frequency * 2.2) / (frequency + 1.2 * (1 - 0.75 + 0.75 * len(tokens) / max(average_length, 1))))

            metadata = chunk.get("metadata") or {}
            metadata_text = " ".join(str(value) for value in metadata.values()).lower()
            score += sum(0.35 for term in query_terms if term in metadata_text)
            if score > 0:
                next_chunk = dict(chunk)
                next_chunk["score"] = score
                ranked.append(next_chunk)

        return sorted(ranked, key=lambda item: float(item.get("score") or 0.0), reverse=True)[:top_k]


simple_retriever = SimpleRetriever()
