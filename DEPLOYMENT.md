# Deployment (Railway + Vercel) for full parity with local

This repo has:

- `portfolio-web/`: Vite + React frontend (portfolio mode or admin mode)
- `app/`: FastAPI backend
- Chroma: runs as `chromadb/chroma` (needs a persistent volume)
- Metadata DB: defaults to SQLite at `data/metadata/app.db` (can be Mongo via `MONGODB_URI`)

The clean production split is:

- **Vercel**: host the frontend(s)
- **Railway (or similar)**: host the FastAPI backend
- **Railway (or similar)**: host Chroma with a persistent volume
- **MongoDB Atlas or Railway Mongo** (recommended): store metadata/projects (optional but best for production)
- **Railway volume**: store uploads + parse artifacts (`/app/data`) if you stay on SQLite or want durable file storage

---

## 0) What “done” looks like (end-to-end)

When everything is correctly deployed:

- Your Railway API URL returns `GET /health` → `{"status":"ok"}`
- Your Vercel portfolio site loads and calls `GET /portfolio` successfully
- Your Vercel admin site can:
  - set settings (`PUT /admin/settings` with `X-Admin-Token`)
  - upload/ingest docs (`POST /upload`)
  - list indexed docs (`GET /admin/chroma/documents`)
  - chat (`POST /chat`)

---

## 1) Railway: API service (you already deployed this)

Do this checklist now:

1. Add a **Railway volume** mounted at `/app/data` (uploads + SQLite + processed files persist).
2. Add the env vars (next section).
3. Redeploy the API service.
4. Verify:
   - `GET /health`
   - `GET /docs`
   - `GET /portfolio`

### API build/start behavior (important)

The repo root `Dockerfile` starts uvicorn with:

- `--port ${PORT:-8000}` (Railway sets `PORT` automatically)
- `--proxy-headers` (correct scheme/host behind Railway proxy)

### API environment variables (Railway)

Required for real chat/indexing:

- `GEMINI_API_KEY`
- `LLAMA_CLOUD_API_KEY`

Recommended:

- `ADMIN_TOKEN` (protects admin endpoints; the admin UI sends it as `X-Admin-Token`)
- `CORS_ALLOW_ORIGINS` (comma-separated exact origins; set after Vercel URLs exist)

Chroma connectivity:

- `CHROMA_HOST` (Railway private hostname of your Chroma service, e.g. `chroma.railway.internal`)
- `CHROMA_PORT` (usually `8000`)
- `CHROMA_COLLECTION_NAME` (optional)
- `CHROMA_SPACE` (optional; default `cosine`)

Metadata DB (optional but recommended):

- `MONGODB_URI` (MongoDB Atlas/Railway connection string)
- `MONGODB_DB` (default `portfolio`)

Storage paths (defaults are fine if you mount `/app/data`):

- `SQLITE_PATH` (default `data/metadata/app.db`)
- `RAW_UPLOAD_DIR` (default `data/raw`)
- `PROCESSED_DIR` (default `data/processed`)

After deploy, confirm:

- `GET /health`
- `GET /portfolio`

---

## 2) Railway: deploy Chroma (persistent) so RAG works

Create a second Railway service for Chroma:

- Image: `chromadb/chroma:1.0.7`
- Port: `8000`
- Volume: mount a volume at `/data`
- Env:
  - `IS_PERSISTENT=TRUE`
  - `PERSIST_DIRECTORY=/data`

Then set on the API service:

- `CHROMA_HOST=<your-chroma-service-private-hostname>`
- `CHROMA_PORT=8000`

Notes:

- In Railway, the private hostname is shown under the service networking/private networking area.
- Once you set `CHROMA_HOST` and `CHROMA_PORT` on the API service, redeploy the API.

---

## 3) Deploy MongoDB (recommended)

Option A (recommended): MongoDB Atlas

- Create an Atlas cluster
- Allow Railway egress IPs (or set a permissive network rule if you accept the risk)
- Put the connection string into `MONGODB_URI` on Railway

Option B: Railway Mongo (if available in your account)

- Provision Mongo and use its connection string as `MONGODB_URI`

If you do not set `MONGODB_URI`, the API uses SQLite at `SQLITE_PATH`. You must mount `/app/data` to keep data across deploys.

---

## 4) Deploy the frontend(s) to Vercel

This frontend is a Vite SPA. Vercel needs:

- Root directory: `portfolio-web`
- Build command: `npm run build`
- Output directory: `dist`

This repo supports two modes via `VITE_APP_MODE`:

- `portfolio` (public site)
- `admin` (admin UI)

Best practice is to deploy **two Vercel projects** pointing at the same `portfolio-web` directory, each with different env vars.

### Vercel project A: Portfolio

Env vars:

- `VITE_APP_MODE=portfolio`
- `VITE_API_BASE_URL=https://<your-railway-api-domain>`

### Vercel project B: Admin

Env vars:

- `VITE_APP_MODE=admin`
- `VITE_API_BASE_URL=https://<your-railway-api-domain>`
- `VITE_PORTFOLIO_ORIGIN=https://<your-portfolio-vercel-domain>` (only used by the admin UI for links)

### CORS (back on Railway)

Once you have your Vercel URLs, set on the API service:

`CORS_ALLOW_ORIGINS=https://<portfolio-vercel-domain>,https://<admin-vercel-domain>`

---

## 5) Recommended “order of operations” (do this next)

Fastest path from “API deployed” → “everything works”:

1. Railway API: add `/app/data` volume → redeploy
2. Railway Chroma: deploy + `/data` volume → get private hostname
3. Railway API: set `CHROMA_HOST`/`CHROMA_PORT` → redeploy
4. (Optional) MongoDB: set `MONGODB_URI`/`MONGODB_DB` → redeploy
5. Vercel Portfolio: set `VITE_API_BASE_URL` → deploy
6. Vercel Admin: set `VITE_API_BASE_URL` + `VITE_PORTFOLIO_ORIGIN` → deploy
7. Railway API: set `CORS_ALLOW_ORIGINS` (both Vercel origins) → redeploy
8. Test admin upload → ingest → chat

---

## 6) Files / code changes already made for hosted deployments

- `Dockerfile`: uses `PORT` with default `8000` and enables proxy headers.
- `app/config.py`: added `CORS_ALLOW_ORIGINS` parsing.
- `app/main.py`: uses `CORS_ALLOW_ORIGINS` when set; otherwise defaults to localhost dev origins.
- `portfolio-web/vercel.json`: SPA rewrite so React Router works on refresh/deep links.
