from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import UploadFile

from app.config import settings


SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".markdown"}


def ensure_storage_dirs() -> None:
    settings.raw_upload_dir.mkdir(parents=True, exist_ok=True)
    settings.processed_dir.mkdir(parents=True, exist_ok=True)
    settings.sqlite_path.parent.mkdir(parents=True, exist_ok=True)


def save_upload(upload: UploadFile, logical_document_key: str, version_id: str) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix or 'unknown'}")

    target_dir = settings.raw_upload_dir / logical_document_key / version_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / (upload.filename or f"{version_id}{suffix}")
    with target_path.open("wb") as output_file:
        shutil.copyfileobj(upload.file, output_file)
    return target_path
