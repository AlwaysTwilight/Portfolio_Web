from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import settings
from app.models import ChatRequest, ChatResponse, DocumentSummary, DocumentVersion, HealthResponse, IngestRequest, UploadResponse
from app.services.chat import chat_service
from app.services.ingestion import ingestion_service
from app.services.metadata import metadata_store
from app.services.portfolio import portfolio_service
from app.services.storage import ensure_storage_dirs, save_upload
from app.services.vector_store import vector_store


app = FastAPI(title="Local RAG Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8501",
        "http://127.0.0.1:8501",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UpdateOpenToWorkRequest(BaseModel):
    open_to_work: bool


def _backfill_active_versions() -> None:
    documents = metadata_store.list_documents()
    if not any(item.get('active_version_id') for item in documents):
        return
    needs_backfill = False
    try:
        primary_count = vector_store._get_collection(settings.chroma_collection_name).count()
        needs_backfill = primary_count == 0 and any(item.get('active_version_id') for item in documents)
    except Exception:
        needs_backfill = any(item.get('active_version_id') for item in documents)

    if not needs_backfill:
        return

    for document in documents:
        active_version_id = document.get('active_version_id')
        if not active_version_id:
            continue
        versions = document.get('versions', [])
        active_version = next((version for version in versions if version.get('version_id') == active_version_id), None)
        if not active_version or active_version.get('status') not in {'indexed', 'embedding', 'indexing'}:
            continue
        try:
            ingestion_service.ingest(active_version_id)
        except Exception:
            continue


@app.on_event("startup")
def on_startup() -> None:
    ensure_storage_dirs()
    metadata_store.initialize()
    _backfill_active_versions()


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get('/portfolio')
def portfolio() -> dict:
    return portfolio_service.get_portfolio_payload()


@app.get("/admin/settings")
def get_admin_settings() -> dict:
    return {"open_to_work": metadata_store.get_open_to_work()}


@app.put("/admin/settings/open-to-work")
def update_open_to_work(request: UpdateOpenToWorkRequest) -> dict:
    metadata_store.set_open_to_work(request.open_to_work)
    return {"open_to_work": metadata_store.get_open_to_work()}


@app.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    logical_document_key: str = Form(...),
    source_label: str | None = Form(default=None),
    ingest_now: bool = Form(default=True),
) -> UploadResponse:
    try:
        suffix = Path(file.filename or "").suffix.lower()
        placeholder_path = f"pending/{logical_document_key}/{file.filename or 'upload'}"
        version_id = metadata_store.create_version(
            logical_document_key=logical_document_key,
            file_name=file.filename or "upload",
            file_type=suffix.lstrip("."),
            storage_path=placeholder_path,
            source_label=source_label,
        )
        stored_path = save_upload(file, logical_document_key, version_id)
        metadata_store.update_storage_path(version_id, str(stored_path))
        metadata_store.update_status(version_id, "uploaded")

        chunk_count = ingestion_service.ingest(version_id) if ingest_now else 0
        return UploadResponse(
            logical_document_key=logical_document_key,
            version_id=version_id,
            status="indexed" if ingest_now else "uploaded",
            chunk_count=chunk_count,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ingest", response_model=UploadResponse)
def ingest_document(request: IngestRequest) -> UploadResponse:
    try:
        chunk_count = ingestion_service.ingest(request.version_id)
        return UploadResponse(
            logical_document_key=request.logical_document_key,
            version_id=request.version_id,
            status="indexed",
            chunk_count=chunk_count,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        return chat_service.answer(request.message, include_debug=request.include_debug, history=request.history)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/documents", response_model=list[DocumentSummary])
def list_documents() -> list[DocumentSummary]:
    return [DocumentSummary(**item) for item in metadata_store.list_documents()]


@app.get("/documents/{logical_document_key}/versions", response_model=list[DocumentVersion])
def list_versions(logical_document_key: str) -> list[DocumentVersion]:
    return [DocumentVersion(**item) for item in metadata_store.list_versions(logical_document_key)]
