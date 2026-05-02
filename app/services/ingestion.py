from __future__ import annotations

import json
from pathlib import Path

from app.config import settings
from app.services.chunker import chunk_text
from app.services.embeddings import embedding_service
from app.services.metadata import metadata_store
from app.services.parser import document_parser
from app.services.vector_store import vector_store


class IngestionService:
    def ingest(self, version_id: str) -> int:
        version = metadata_store.get_version(version_id)
        if not version:
            raise ValueError(f'Unknown version_id: {version_id}')

        metadata_store.update_status(version_id, 'parsing')
        file_path = Path(version['storage_path'])
        parsed_text = document_parser.parse(file_path)

        processed_dir = settings.processed_dir / version['logical_document_key'] / version_id
        processed_dir.mkdir(parents=True, exist_ok=True)
        parsed_path = processed_dir / 'parsed.md'
        parsed_path.write_text(parsed_text, encoding='utf-8')

        metadata_store.update_status(version_id, 'chunking', parse_artifact_path=str(parsed_path))
        chunks = chunk_text(parsed_text)
        if not chunks:
            raise ValueError(f'No chunks produced for {file_path.name}')

        chunk_texts = [chunk.text for chunk in chunks]
        ids = [f"{version['version_id']}::{index}" for index, _chunk in enumerate(chunks)]
        metadatas: list[dict[str, object]] = []
        for index, chunk in enumerate(chunks):
            metadata = {
                'logical_document_key': version['logical_document_key'],
                'version_id': version['version_id'],
                'document_id': version['version_id'],
                'file_name': version['file_name'],
                'file_type': version['file_type'],
                'upload_timestamp': version['upload_timestamp'],
                'chunk_index': index,
                'is_active': True,
                'source_label': version['source_label'] or '',
            }
            metadata.update(chunk.metadata())
            metadatas.append(metadata)

        metadata_store.update_status(version_id, 'embedding')
        embeddings = embedding_service.embed_documents(chunk_texts)
        metadata_store.update_status(version_id, 'indexing')
        vector_store.deactivate_logical_document(settings.chroma_collection_name, version['logical_document_key'])
        vector_store.upsert_chunks(
            settings.chroma_collection_name,
            ids=ids,
            documents=chunk_texts,
            embeddings=embeddings,
            metadatas=metadatas,
        )
        metadata_store.activate_version(version['logical_document_key'], version_id)

        manifest_path = processed_dir / 'manifest.json'
        manifest_path.write_text(
            json.dumps(
                {
                    'chunk_count': len(chunks),
                    'version_id': version_id,
                    'embedding_index': {
                        'provider': 'gemini',
                        'collection': settings.chroma_collection_name,
                        'indexed': True,
                        'chunk_count': len(chunks),
                    },
                    'chunks': [
                        {
                            'index': index,
                            'section_title': chunk.section_title,
                            'section_path': chunk.section_path,
                            'semantic_type': chunk.semantic_type,
                            'chunk_index_within_section': chunk.chunk_index_within_section,
                            'char_count': len(chunk.text),
                        }
                        for index, chunk in enumerate(chunks)
                    ],
                },
                indent=2,
            ),
            encoding='utf-8',
        )
        metadata_store.update_status(version_id, 'indexed', chunk_count=len(chunks))
        return len(chunks)


ingestion_service = IngestionService()
