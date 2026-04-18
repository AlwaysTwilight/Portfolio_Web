from __future__ import annotations

from typing import Any, List, Optional

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    logical_document_key: str
    version_id: str
    status: str
    chunk_count: int = 0
    project_id: Optional[str] = None


class IngestRequest(BaseModel):
    logical_document_key: str
    version_id: str


class ConversationTurn(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    include_debug: bool = False
    history: List[ConversationTurn] = Field(default_factory=list)
    active_project_title: Optional[str] = None


class SourceItem(BaseModel):
    logical_document_key: str
    version_id: str
    file_name: str
    source_label: Optional[str] = None
    section_title: Optional[str] = None
    section_path: Optional[str] = None
    semantic_type: Optional[str] = None
    chunk_index: int
    snippet: str


class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceItem]
    debug: Optional[List[dict[str, Any]]] = None


class DocumentVersion(BaseModel):
    version_id: str
    file_name: str
    file_type: str
    storage_path: str
    upload_timestamp: str
    status: str
    is_active: bool
    source_label: Optional[str] = None
    chunk_count: int = 0


class DocumentSummary(BaseModel):
    logical_document_key: str
    active_version_id: Optional[str] = None
    updated_at: Optional[str] = None
    versions: List[DocumentVersion] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
