# EC2 Backend + Vercel Frontend Deployment

This is the exact path for the current setup:

- EC2 runs `api`, `mongo`, and `chroma` with Docker Compose.
- Vercel hosts the React frontend.
- Vercel proxies `/api/*` to the EC2 backend using `BACKEND_ORIGIN`.

## 1. EC2 Backend

From the EC2 repo folder:

```bash
cd ~/Portfolio_Web
cp .env.example .env
nano .env
```

Minimum `.env` values:

```env
GEMINI_API_KEY=your_gemini_key
LLAMA_CLOUD_API_KEY=your_llama_cloud_key
ADMIN_TOKEN=make_a_long_random_token
MONGODB_URI=mongodb://mongo:27017
CHROMA_HOST=chroma
CHROMA_PORT=8000
PORT=8000
CORS_ALLOW_ORIGINS=https://your-portfolio.vercel.app,https://your-admin.vercel.app
CORS_ALLOW_ORIGIN_REGEX=https://.*\.vercel\.app
```

Start or rebuild:

```bash
docker compose down
docker compose up -d --build
docker compose logs -f --tail=100 api
```

Test from EC2:

```bash
curl http://localhost:8000/health
```

Test from your laptop:

```bash
curl http://EC2_PUBLIC_IP:8000/health
```

Your EC2 security group must allow inbound TCP `8000` from the internet, or at least from Vercel/user traffic.

## 2. Vercel Portfolio Project

Create a Vercel project from the same GitHub repo.

Settings:

- Root Directory: `portfolio-web`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variables:

```env
VITE_APP_MODE=portfolio
VITE_API_BASE_URL=/api
BACKEND_ORIGIN=http://EC2_PUBLIC_IP:8000
```

Deploy.

## 3. Vercel Admin Project

Create a second Vercel project from the same GitHub repo.

Settings:

- Root Directory: `portfolio-web`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

Environment variables:

```env
VITE_APP_MODE=admin
VITE_API_BASE_URL=/api
VITE_PORTFOLIO_ORIGIN=https://your-portfolio.vercel.app
BACKEND_ORIGIN=http://EC2_PUBLIC_IP:8000
```

Deploy.

## 4. Final Checks

Backend:

```bash
docker compose ps
curl http://localhost:8000/health
curl http://localhost:8000/docs
```

Portfolio:

- Open the Vercel portfolio URL.
- Confirm profile/projects load.
- Open browser dev tools and confirm API calls go to `/api/...`.

Admin:

- Open the Vercel admin URL.
- Enter the same `ADMIN_TOKEN` from EC2 `.env`.
- Upload a document.
- Confirm Chroma-backed documents show up.
- Ask a chat question about the uploaded document.

## 5. Updating Later

On EC2:

```bash
cd ~/Portfolio_Web
git pull
docker compose down
docker compose up -d --build
docker compose logs -f --tail=100 api
```

On Vercel:

- Push to GitHub.
- Vercel redeploys automatically.

