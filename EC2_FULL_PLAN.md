# EC2 Hosting Plan + Full Project Context (Portfolio RAG Stack)

Date: 2026-05-03 (Asia/Kolkata)

This file is meant to be copy-pasted into ChatGPT (or shared with a teammate) so they understand:
1) what this repo contains and how it works end-to-end
2) how to deploy it on a single AWS EC2 `t2.micro` using Docker
3) how to set up a domain + HTTPS
4) how ChromaDB is restored as the main vector database

---

## 0) Repo Map (What’s Where)

Top-level folders:

- `app/` — **FastAPI backend** (API + ingestion + RAG + portfolio payload).
- `ui/` — **Streamlit admin/test UI** (upload docs, ingest, inspect, chat).
- `portfolio-web/` — **React (Vite) frontend** (two modes: `portfolio` and `admin`).
- `data/` — Local persistent storage (uploads, SQLite, processed chunks).
- `logs/` — local logs (if used by your environment).

Top-level files:

- `Dockerfile` — builds the backend image (FastAPI + Streamlit code).
- `docker-compose.yml` — local dev stack (mongo + api + streamlit + portfolio/admin).
- `.env` — local env vars (do not commit).
- `.env.example` — env template.
- `README.md` — local setup instructions.
- `DEPLOYMENT.md` — older “Render + Vercel” deployment notes; EC2 setup in this file is now the source of truth for Chroma.

---

## 1) Architecture (What the System Does)

### 1.1 Backend (FastAPI) — `app/`

Primary endpoints:

- `GET /health` — health check.
- `POST /upload` — upload a file and create a new “version” under a stable `logical_document_key`.
- `POST /ingest` — parse + chunk + index a previously uploaded version.
- `POST /chat` — answer a question using retrieval + LLM.
- `GET /documents` — list logical documents + versions.
- `GET /documents/{logical_document_key}/versions` — list versions.
- `GET /portfolio` — returns a single payload used by the portfolio frontend (profile + projects + documents).

Key backend responsibilities:

1) **Upload storage**
   - Uploads are saved under `data/raw/...` (configured via `RAW_UPLOAD_DIR`).
2) **Metadata**
   - Stored in SQLite at `data/metadata/app.db` (configured via `SQLITE_PATH`).
   - Tracks logical docs, version IDs, status, artifact paths, etc.
3) **Parsing**
   - Uses LlamaParse (`LLAMA_CLOUD_API_KEY`) to convert PDFs/DOCX/etc into clean markdown.
4) **Chunking + indexing**
   - Chunks are written as JSON under `data/processed/.../chunks.json`.
5) **Retrieval**
   - Current default retrieval uses Gemini embeddings stored in ChromaDB, followed by local reranking.
6) **LLM answering**
   - Uses Gemini by default (`GEMINI_API_KEY`) to generate answers grounded in retrieved chunks.

Important note:
- ChromaDB is now a required service for the restored RAG path.

### 1.2 Streamlit UI — `ui/`

- A small admin/test UI at port `8501`.
- Lets you:
  - set `ADMIN_TOKEN`
  - upload docs
  - ingest/index docs
  - chat against indexed content
  - inspect document/version state

### 1.3 React Frontend (Vite) — `portfolio-web/`

The same codebase runs in 2 modes:

- `VITE_APP_MODE=portfolio` — public portfolio site.
- `VITE_APP_MODE=admin` — admin UI (uploads/ingest/chat/controls).

The frontend calls the backend using:
- `VITE_API_BASE_URL` (example: `http://localhost:8000` in dev)

---

## 2) Deployment Target: Single EC2 (`t2.micro`) Reality Check

`t2.micro` is tight:

- 1 vCPU, 1 GB RAM (burstable)
- Docker + Mongo + Chroma + API + frontend can run, but you must be careful:
  - enable swap
  - keep logs small
  - avoid heavy ingestion workloads at the same time as serving traffic

If you want “no surprises”:
- Prefer: `api + chroma + nginx/caddy + static frontends`, and keep Mongo only if you still need it.

---

## 3) The Recommended EC2 Deployment Pattern (Docker + Nginx + HTTPS)

### 3.1 What you will run on EC2

On the EC2 box:

- `api` (FastAPI) container
- (optional) `mongo` container if you still use MongoDB features
- `chroma` container for vector search
- `nginx` container (reverse proxy + TLS termination)
- two static frontend sites:
  - `portfolio` (served at `https://yourdomain.com`)
  - `admin` (served at `https://admin.yourdomain.com`)

### 3.2 Why Nginx?

- Handles HTTPS certificates (via certbot or a TLS-enabled proxy)
- Routes:
  - `/api/*` to FastAPI
  - `/` to portfolio static site
  - `admin.yourdomain.com` to admin static site

---

## 4) Domain + DNS (Where to Buy and What to Choose)

### 4.1 Where to buy a domain

Any of these are fine:

- Cloudflare Registrar (often cheapest; best DNS UX)
- Namecheap / Porkbun / GoDaddy (works, but DNS UX varies)
- Route 53 (AWS-native, not usually cheapest)

### 4.2 What domain to pick (simple approach)

Use:

- `yourdomain.com` → portfolio site
- `admin.yourdomain.com` → admin site
- `api.yourdomain.com` → backend API

You can also avoid a separate `api.` subdomain and instead route `/api` at the root domain. Subdomains are simpler to reason about.

### 4.3 DNS records you will create

Assuming you have an Elastic IP (recommended):

- `A` record: `yourdomain.com` → `EC2_PUBLIC_IP`
- `A` record: `admin.yourdomain.com` → `EC2_PUBLIC_IP`
- `A` record: `api.yourdomain.com` → `EC2_PUBLIC_IP`

---

## 5) Step-by-Step EC2 Plan (Git pull → run)

### 5.1 EC2 instance setup

1) Launch EC2:
   - Ubuntu 22.04 LTS (recommended)
   - instance type: `t2.micro`
   - attach a bigger disk than default if you will store uploads (20–30 GB)
2) Allocate and associate an **Elastic IP** (so your IP doesn’t change).
3) Security group inbound rules:
   - `22` (SSH) from your IP only
   - `80` (HTTP) from `0.0.0.0/0`
   - `443` (HTTPS) from `0.0.0.0/0`
4) SSH into the server.

### 5.2 Install Docker

Install Docker Engine + Compose plugin (Ubuntu):
- follow Docker’s official install steps for Ubuntu

Then ensure your user can run Docker:
- add user to the `docker` group
- re-login

### 5.3 Enable swap (important on 1 GB RAM)

Create 2 GB swap file (example):
- `sudo fallocate -l 2G /swapfile`
- `sudo chmod 600 /swapfile`
- `sudo mkswap /swapfile`
- `sudo swapon /swapfile`
- persist swap in `/etc/fstab`

### 5.4 Pull your repo and configure env

1) `git clone <your repo>`
2) `cd Portfolio`
3) `cp .env.example .env`
4) Fill `.env`:
   - `GEMINI_API_KEY`
   - `LLAMA_CLOUD_API_KEY`
   - `ADMIN_TOKEN` (set this!)
   - CORS values (see below)

### 5.5 Choose a “production compose”

You have 2 viable options:

Option A (simplest): run everything directly on ports
- Use `docker-compose.yml`
- Put Nginx/HTTPS in front later

Option B (recommended): use a dedicated EC2 compose with reverse proxy + persistence
- Use `docker-compose.ec2.yml` (added in this repo; see below)

### 5.6 Start the stack

- Build the static frontends (do this on EC2 or on your laptop and commit the `dist-*` folders if you want):

```bash
cd portfolio-web
npm ci

# Build portfolio
rm -rf dist && VITE_APP_MODE=portfolio VITE_API_BASE_URL=https://api.yourdomain.com npm run build
mv dist dist-portfolio

# Build admin
rm -rf dist && VITE_APP_MODE=admin VITE_API_BASE_URL=https://api.yourdomain.com VITE_PORTFOLIO_ORIGIN=https://yourdomain.com npm run build
mv dist dist-admin
cd ..
```

- `docker compose -f docker-compose.ec2.yml up -d --build`

### 5.7 Configure CORS (backend)

If your domain is:
- portfolio: `https://yourdomain.com`
- admin: `https://admin.yourdomain.com`

Set:

```env
CORS_ALLOW_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

Then restart:
- `docker compose -f docker-compose.ec2.yml restart api`

### 5.8 HTTPS certificates

Two common approaches:

1) Nginx + Certbot on the host (classic)
2) Caddy (simpler automatic HTTPS) as your reverse proxy container

This repo’s `docker-compose.ec2.yml` uses **Caddy** because it’s the easiest “it just works” option on a small server.

You will set:
- `CADDY_EMAIL=you@example.com`

and Caddy will automatically request and renew Let’s Encrypt certs for:
- `yourdomain.com`
- `admin.yourdomain.com`
- `api.yourdomain.com`

---

## 6) “Redo ChromaDB” (What That Means Here)

This repo now retrieves through ChromaDB again. “Full ChromaDB and everything” means:

1) a running **ChromaDB server** (container) with a persistent volume
2) an **embedding model** choice (OpenAI / local model / Gemini embeddings, etc.)
3) code that:
   - creates a collection
   - upserts chunks with embeddings + metadata
   - queries by embedding similarity at chat time

What this repo provides now:
- a Chroma service in Docker Compose with persistent storage
- Gemini embedding generation during ingestion
- Chroma upserts for document chunks and metadata
- Chroma vector retrieval in `/chat`
- Chroma-backed document listing at `GET /admin/chroma/documents` and `GET /admin/rag/documents`

---

## 7) Files Added/Changed in This Repo For EC2 Hosting

- `docker-compose.ec2.yml` — production-ish stack for EC2 (Caddy reverse proxy + persistence + Chroma + optional Mongo).
- `Caddyfile` — reverse proxy routes and TLS hosts.
- Updates to:
  - `docker-compose.yml` (adds a `chroma` service for local dev parity)
  - `.env.example` (adds Chroma env variables)

---

## 8) “One Command” Server Operations Cheat Sheet

From the repo root on EC2:

- Start/update: `docker compose -f docker-compose.ec2.yml up -d --build`
- Logs: `docker compose -f docker-compose.ec2.yml logs -f --tail=200`
- Restart API: `docker compose -f docker-compose.ec2.yml restart api`
- Stop: `docker compose -f docker-compose.ec2.yml down`

---

## 9) What you should commit to Git vs NOT commit

Commit:
- `EC2_FULL_PLAN.md`
- `docker-compose.ec2.yml`
- `Caddyfile`
- `docker-compose.yml` changes
- `.env.example` changes

Do NOT commit:
- `.env`
- `data/` (unless you intentionally want to ship your local DB/uploads)

---

## 10) Next Optional Improvements (If You Want Production Quality)

- Put Mongo behind auth or remove it if unused.
- Add basic auth for `/docs` and admin endpoints.
- Add backups for `data/metadata/app.db` and `data/processed`.
- Add rate-limiting (Caddy can do this with plugins; Nginx can too).
- Add backups for the Chroma volume if the portfolio documents become important production data.
