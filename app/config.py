from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_env_file() -> None:
    env_path = Path('.env')
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in stripped:
            continue
        key, value = stripped.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file()


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = os.getenv('GEMINI_API_KEY', '')
    groq_api_key: str = os.getenv('GROQ_API_KEY', '')
    openrouter_api_key: str = os.getenv('OPENROUTER_API_KEY', '')
    llama_cloud_api_key: str = os.getenv('LLAMA_CLOUD_API_KEY', '')
    gemini_embedding_model: str = os.getenv('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001')
    gemini_chat_model: str = os.getenv('GEMINI_CHAT_MODEL', 'gemini-2.5-flash-lite')
    gemini_embedding_dim: int = int(os.getenv('GEMINI_EMBEDDING_DIM', '768'))
    groq_chat_model: str = os.getenv('GROQ_CHAT_MODEL', 'llama-3.1-8b-instant')
    openrouter_chat_model: str = os.getenv('OPENROUTER_CHAT_MODEL', 'qwen/qwen-2.5-7b-instruct')
    chroma_host: str = os.getenv('CHROMA_HOST', 'localhost')
    chroma_port: int = int(os.getenv('CHROMA_PORT', '8000'))
    sqlite_path: Path = Path(os.getenv('SQLITE_PATH', 'data/metadata/app.db'))
    raw_upload_dir: Path = Path(os.getenv('RAW_UPLOAD_DIR', 'data/raw'))
    processed_dir: Path = Path(os.getenv('PROCESSED_DIR', 'data/processed'))
    chunk_size: int = int(os.getenv('CHUNK_SIZE', '1000'))
    chunk_overlap: int = int(os.getenv('CHUNK_OVERLAP', '150'))
    top_k: int = int(os.getenv('TOP_K', '4'))
    chroma_collection_name: str = os.getenv('CHROMA_COLLECTION_NAME', 'documents_gemini')
    chroma_space: str = os.getenv('CHROMA_SPACE', 'cosine')


settings = Settings()
