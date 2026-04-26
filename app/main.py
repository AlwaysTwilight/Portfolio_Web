from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import settings
from app.models import ChatRequest, ChatResponse, DocumentSummary, DocumentVersion, HealthResponse, IngestRequest, UploadResponse
from app.services.chat import chat_service
from app.services.ingestion import ingestion_service
from app.services.metadata import metadata_store
from app.services.portfolio import portfolio_service
from app.services.project_cards import extract_project_card
from app.services.simple_retriever import simple_retriever
from app.services.storage import ensure_storage_dirs, save_upload


app = FastAPI(title="Local RAG Backend", version="0.1.0")

cors_origins = (
    settings.cors_allow_origins
    if settings.cors_allow_origins
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8501",
        "http://127.0.0.1:8501",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UpdateSettingsRequest(BaseModel):
    open_to_work: bool
    current_location: str
    desired_locations: list[str]


class UpsertProjectRequest(BaseModel):
    title: str
    summary: str
    tech_stack: list[str] = []
    source_path: str = "Admin"
    sort_order: int = 0
    what_it_does: list[str] = []
    is_visible: bool = True
    source_logical_document_key: str | None = None
    source_version_id: str | None = None


def _require_admin(x_admin_token: str | None) -> None:
    # If ADMIN_TOKEN is unset, keep local dev friction-free.
    if not settings.admin_token:
        return
    if not x_admin_token or x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _backfill_active_versions() -> None:
    documents = metadata_store.list_documents()
    if not any(item.get('active_version_id') for item in documents):
        return
    for document in documents:
        active_version_id = document.get('active_version_id')
        if not active_version_id:
            continue
        versions = document.get('versions', [])
        active_version = next((version for version in versions if version.get('version_id') == active_version_id), None)
        if not active_version or active_version.get('status') not in {'indexed', 'indexing'}:
            continue
        if simple_retriever.chunks_path(document['logical_document_key'], active_version_id).exists():
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


@app.get("/")
def root() -> dict:
    return {"message": "API running"}


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get('/portfolio')
def portfolio() -> dict:
    return portfolio_service.get_portfolio_payload()


@app.get("/admin/settings")
def get_admin_settings() -> dict:
    return {
        "open_to_work": metadata_store.get_open_to_work(),
        "current_location": metadata_store.get_current_location(),
        "desired_locations": metadata_store.get_desired_locations(),
    }


@app.put("/admin/settings")
def update_admin_settings(request: UpdateSettingsRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.set_open_to_work(request.open_to_work)
    metadata_store.set_current_location(request.current_location)
    metadata_store.set_desired_locations(request.desired_locations)
    return {
        "open_to_work": metadata_store.get_open_to_work(),
        "current_location": metadata_store.get_current_location(),
        "desired_locations": metadata_store.get_desired_locations(),
    }


@app.get("/admin/projects")
def list_admin_projects(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    return {"projects": metadata_store.list_portfolio_projects()}


@app.get("/admin/rag/documents")
def list_rag_documents(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    return {"documents": simple_retriever.active_documents()}


@app.get("/admin/chroma/documents")
def list_chroma_documents(x_admin_token: str | None = Header(default=None)) -> dict:
    return list_rag_documents(x_admin_token)


@app.post("/admin/projects")
def create_admin_project(request: UpsertProjectRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    project_id = metadata_store.upsert_portfolio_project(
        project_id=None,
        title=request.title.strip(),
        summary=request.summary.strip(),
        tech_stack=[item.strip() for item in request.tech_stack if item.strip()],
        source_path=(request.source_path or "Admin").strip() or "Admin",
        sort_order=int(request.sort_order or 0),
        what_it_does=[item.strip() for item in request.what_it_does if item.strip()],
        is_visible=request.is_visible,
        source_logical_document_key=request.source_logical_document_key,
        source_version_id=request.source_version_id,
    )
    return {"project": {"id": project_id}}


@app.put("/admin/projects/{project_id}")
def update_admin_project(
    project_id: str,
    request: UpsertProjectRequest,
    x_admin_token: str | None = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    updated_id = metadata_store.upsert_portfolio_project(
        project_id=project_id,
        title=request.title.strip(),
        summary=request.summary.strip(),
        tech_stack=[item.strip() for item in request.tech_stack if item.strip()],
        source_path=(request.source_path or "Admin").strip() or "Admin",
        sort_order=int(request.sort_order or 0),
        what_it_does=[item.strip() for item in request.what_it_does if item.strip()],
        is_visible=request.is_visible,
        source_logical_document_key=request.source_logical_document_key,
        source_version_id=request.source_version_id,
    )
    return {"project": {"id": updated_id}}


@app.delete("/admin/projects/{project_id}")
def delete_admin_project(project_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.delete_portfolio_project(project_id)
    return {"deleted": True}


@app.put("/admin/documents/{logical_document_key}/versions/{version_id}/activate")
def activate_document_version(logical_document_key: str, version_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.activate_version(logical_document_key, version_id)
    return {"status": "activated"}


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    project = None
    if hasattr(metadata_store, "get_portfolio_project"):
        project = getattr(metadata_store, "get_portfolio_project")(project_id)
    if not project:
        # Fallback: support built-in seed markdown projects (not stored in DB).
        try:
            from pathlib import Path as _Path

            for path in getattr(portfolio_service, "project_files", []):
                seed_path = _Path(path)
                if not seed_path.exists():
                    continue
                base_payload = portfolio_service._project_payload(seed_path)
                if str(base_payload.get("id") or "") == project_id:
                    markdown = seed_path.read_text(encoding="utf-8", errors="ignore")
                    extracted = extract_project_card(markdown, fallback_title=str(base_payload.get("title") or seed_path.stem))
                    project = {
                        **base_payload,
                        "whatItDoes": extracted.get("whatItDoes") or [],
                    }
                    break
        except Exception:
            project = None
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # If we have a source version, derive "what it does" from the parsed markdown (best-effort).
    if not project.get("whatItDoes") and project.get("sourceVersionId"):
        version = metadata_store.get_version(str(project["sourceVersionId"])) or {}
        parsed_path = version.get("parse_artifact_path")
        if parsed_path:
            try:
                markdown = Path(str(parsed_path)).read_text(encoding="utf-8", errors="ignore")
                extracted = extract_project_card(markdown, fallback_title=str(project.get("title") or "Project"))
                project["whatItDoes"] = extracted.get("whatItDoes") or []
                if not project.get("techStack"):
                    project["techStack"] = extracted.get("techStack") or []
                if not project.get("summary"):
                    project["summary"] = extracted.get("summary") or project.get("title") or ""
            except Exception:
                pass
    return {"project": project}


@app.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    logical_document_key: str = Form(...),
    source_label: str | None = Form(default=None),
    ingest_now: bool = Form(default=True),
    create_project: bool = Form(default=False),
    project_id: str | None = Form(default=None),
    project_title: str | None = Form(default=None),
    project_sort_order: int = Form(default=0),
    project_source_path: str | None = Form(default=None),
    x_admin_token: str | None = Header(default=None),
) -> UploadResponse:
    try:
        if create_project:
            _require_admin(x_admin_token)
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
        response = UploadResponse(
            logical_document_key=logical_document_key,
            version_id=version_id,
            status="indexed" if ingest_now else "uploaded",
            chunk_count=chunk_count,
        )

        if create_project and ingest_now:
            version = metadata_store.get_version(version_id) or {}
            parsed_path = version.get("parse_artifact_path")
            markdown = ""
            if parsed_path:
                try:
                    markdown = Path(str(parsed_path)).read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    markdown = ""
            fallback_title = (project_title or file.filename or logical_document_key or "Project").strip()
            extracted = extract_project_card(markdown, fallback_title=fallback_title)
            title = (project_title or str(extracted.get("title") or fallback_title)).strip() or fallback_title
            summary = str(extracted.get("summary") or "").strip()
            tech_stack = extracted.get("techStack") if isinstance(extracted.get("techStack"), list) else []
            what_it_does = extracted.get("whatItDoes") if isinstance(extracted.get("whatItDoes"), list) else []
            source_path = (project_source_path or file.filename or "Admin").strip() or "Admin"
            saved_project_id = metadata_store.upsert_portfolio_project(
                project_id=(project_id.strip() if project_id else None),
                title=title,
                summary=summary or title,
                tech_stack=[str(item).strip() for item in tech_stack if str(item).strip()],
                what_it_does=[str(item).strip() for item in what_it_does if str(item).strip()],
                source_path=source_path,
                sort_order=int(project_sort_order or 0),
                source_logical_document_key=logical_document_key,
                source_version_id=version_id,
            )
            response.project_id = saved_project_id

        return response
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
        return chat_service.answer(
            request.message,
            include_debug=request.include_debug,
            history=request.history,
            active_project_title=request.active_project_title,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/documents", response_model=list[DocumentSummary])
def list_documents() -> list[DocumentSummary]:
    return [DocumentSummary(**item) for item in metadata_store.list_documents()]


@app.get("/documents/{logical_document_key}/versions", response_model=list[DocumentVersion])
def list_versions(logical_document_key: str) -> list[DocumentVersion]:
    return [DocumentVersion(**item) for item in metadata_store.list_versions(logical_document_key)]
