from __future__ import annotations

from typing import Any

import chromadb

from app.config import settings


class VectorStore:
    def __init__(self) -> None:
        self._client: chromadb.HttpClient | None = None
        self._collections: dict[str, Any] = {}

    def _ensure_client(self) -> chromadb.HttpClient:
        if self._client is None:
            self._client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
        return self._client

    def _get_collection(self, collection_name: str):
        if collection_name not in self._collections:
            client = self._ensure_client()
            desired_metadata = {'hnsw:space': settings.chroma_space}
            try:
                existing = client.get_collection(name=collection_name)
                existing_metadata = existing.metadata or {}
                if existing_metadata.get('hnsw:space') != settings.chroma_space:
                    client.delete_collection(name=collection_name)
                    collection = client.get_or_create_collection(name=collection_name, metadata=desired_metadata)
                else:
                    collection = existing
            except Exception:  # noqa: BLE001
                collection = client.get_or_create_collection(name=collection_name, metadata=desired_metadata)
            self._collections[collection_name] = collection
        return self._collections[collection_name]

    def upsert_chunks(self, collection_name: str, ids: list[str], documents: list[str], embeddings: list[list[float]], metadatas: list[dict[str, Any]]) -> None:
        self._get_collection(collection_name).upsert(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)

    def deactivate_logical_document(self, collection_name: str, logical_document_key: str) -> None:
        collection = self._get_collection(collection_name)
        result = collection.get(where={'logical_document_key': logical_document_key}, include=['metadatas'])
        ids = result.get('ids', [])
        metadatas = result.get('metadatas', [])
        if not ids:
            return
        updated_metadatas = []
        for metadata in metadatas:
            next_metadata = dict(metadata)
            next_metadata['is_active'] = False
            updated_metadatas.append(next_metadata)
        collection.update(ids=ids, metadatas=updated_metadatas)

    def search_active(self, collection_name: str, query_embedding: list[float], top_k: int) -> dict[str, Any]:
        return self._get_collection(collection_name).query(query_embeddings=[query_embedding], n_results=top_k, where={'is_active': True})

    def get_active_document_chunks(self, collection_name: str, logical_document_key: str, version_id: str) -> dict[str, Any]:
        return self._get_collection(collection_name).get(
            where={
                '$and': [
                    {'is_active': True},
                    {'logical_document_key': logical_document_key},
                    {'version_id': version_id},
                ]
            },
            include=['documents', 'metadatas'],
        )


vector_store = VectorStore()
