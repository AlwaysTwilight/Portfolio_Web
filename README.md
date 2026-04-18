# Local RAG Backend

This project is a local-first document chatbot backend built with FastAPI, LlamaParse, Gemini, SQLite metadata, and Chroma running in Docker.

## What it does

- Upload `PDF`, `DOCX`, and `TXT` files.
- Create a new version for each upload under a stable `logical_document_key`.
- Parse content with LlamaParse.
- Chunk, embed, and index content into Chroma.
- Keep old versions for history.
- Retrieve only the latest active version by default.
- Answer questions with Gemini using grounded context.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `GEMINI_API_KEY` and `LLAMA_CLOUD_API_KEY`.
3. Start the stack:

```powershell
docker compose up --build
```

The API will be available at `http://localhost:8001`.
The Streamlit test UI will be available at `http://localhost:8501`.

## Helpful endpoints

- `GET /health`
- `POST /upload`
- `POST /ingest`
- `POST /chat`
- `GET /documents`
- `GET /documents/{logical_document_key}/versions`

## Browser UI

Open `http://localhost:8501` to:

- upload a file
- trigger indexing
- inspect indexed documents and versions
- chat with the indexed content

## Local dev without Docker

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

For local dev, set `CHROMA_HOST=localhost` in `.env` if Chroma is running outside Docker.
