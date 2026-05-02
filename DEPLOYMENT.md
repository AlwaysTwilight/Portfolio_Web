# Deployment (Historical Render + Vercel Notes)

> Note: This file documents the older simple-RAG deployment path. The current restored setup uses ChromaDB and Gemini embeddings again. For the EC2 plan, use `EC2_FULL_PLAN.md`.

This version does **not** use Chroma, embeddings, FAISS, Pinecone, or any vector database.

RAG now works like this:

1. Upload a document from the admin UI.
2. Backend parses it with LlamaParse.
3. Backend chunks the parsed text.
4. Chunks are stored as JSON under `data/processed/.../chunks.json`.
5. Chat retrieves top chunks using simple BM25-style keyword scoring.
6. The selected chunks are sent to the LLM as context.

This is much easier to deploy because you only need:

- Vercel for the React frontend.
- Render for the FastAPI backend.
- Render persistent disk for uploads, SQLite, parsed files, and chunk JSON.
- Optional MongoDB Atlas if you want metadata outside SQLite.

---

## 1. Backend Deploy: Render

Create a new Render **Web Service**.

Settings:

- Runtime: Docker
- Root directory: repository root
- Dockerfile path: `Dockerfile`
- Health check path: `/health`

The backend uses Render's `PORT` automatically:

```bash
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers
```

---

## 2. Render Persistent Disk

Add a Render persistent disk to the backend service.

Mount path:

```text
/app/data
```

This stores:

- uploaded files
- SQLite DB
- parsed markdown
- chunk JSON retrieval index

Without this disk, uploads and indexed chunks can disappear after redeploys.

---

## 3. Render Environment Variables

Required:

```env
GEMINI_API_KEY=your_key
LLAMA_CLOUD_API_KEY=your_key
ADMIN_TOKEN=some_secure_token
```

Recommended:

```env
SQLITE_PATH=data/metadata/app.db
RAW_UPLOAD_DIR=data/raw
PROCESSED_DIR=data/processed
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
TOP_K=4
```

Set this after Vercel deploys:

```env
CORS_ALLOW_ORIGINS=https://your-portfolio.vercel.app,https://your-admin.vercel.app
CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app
```

Optional MongoDB Atlas:

```env
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB=portfolio
```

If you skip MongoDB, SQLite works fine as long as `/app/data` is mounted.

---

## 4. Backend Checks

After Render deploys, test:

```text
https://your-render-api.onrender.com/
https://your-render-api.onrender.com/health
https://your-render-api.onrender.com/docs
https://your-render-api.onrender.com/portfolio
```

Expected:

- `/` returns `{"message":"API running"}`
- `/health` returns `{"status":"ok"}`

---

## 5. Frontend Deploy: Vercel

Create two Vercel projects from the same repo and same root directory.

Vercel settings for both:

- Root directory: `portfolio-web`
- Build command: `npm run build`
- Output directory: `dist`

### Portfolio Vercel Project

Environment variables:

```env
VITE_APP_MODE=portfolio
VITE_API_BASE_URL=https://your-render-api.onrender.com
```

For your current deployment:

```env
VITE_APP_MODE=portfolio
VITE_API_BASE_URL=https://portfolio-web-htpn.onrender.com
```

### Admin Vercel Project

Environment variables:

```env
VITE_APP_MODE=admin
VITE_API_BASE_URL=https://your-render-api.onrender.com
VITE_PORTFOLIO_ORIGIN=https://your-portfolio.vercel.app
```

For your current deployment:

```env
VITE_APP_MODE=admin
VITE_API_BASE_URL=https://portfolio-web-htpn.onrender.com
VITE_PORTFOLIO_ORIGIN=https://portfolio-web-five-tawny.vercel.app
```

After both frontend projects are deployed, update Render:

```env
CORS_ALLOW_ORIGINS=https://your-portfolio.vercel.app,https://your-admin.vercel.app
CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app
```

Then redeploy the Render backend.

---

## 6. Final End-to-End Test

Use the admin Vercel URL:

1. Enter the same `ADMIN_TOKEN` that you set on Render.
2. Upload a PDF, DOCX, TXT, MD, or Markdown file.
3. Keep `Index immediately after upload` checked.
4. Confirm the Knowledge Base shows active RAG sources.
5. Open the portfolio site.
6. Ask the chatbot a question about the uploaded file.

If the answer cites uploaded content, the simple RAG system is working.

---

## 7. What Was Removed

Removed runtime dependency on:

- ChromaDB
- embedding generation
- Railway private Chroma networking
- separate vector DB service

The old frontend-compatible endpoint still exists:

```text
GET /admin/chroma/documents
```

But it now returns the same data as:

```text
GET /admin/rag/documents
```

This keeps older UI code from breaking while the app uses simple local RAG internally.
