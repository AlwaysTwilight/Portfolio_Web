# Sentiment Analysis System - Complete Technical Deep Dive

## 1. What Is This System?

This is an **automated call center sentiment analysis pipeline** built into a 3CX phone system dashboard. It takes phone call recordings from a 3CX PBX (Private Branch Exchange), transcribes the audio to text, analyzes the emotional tone of each call, and presents actionable insights through a web dashboard.

**In one sentence:** *"We automatically listen to every call recording, figure out if the customer was happy, upset, or neutral, and present a daily intelligence report to management."*

---

## 2. End-to-End Flow (The Big Picture)

```
3CX PBX Phone System
        |
        | (External sync - not part of this app)
        v
   AWS S3 Bucket (organized by date: YYYY-MM-DD/)
        |
        | (Discovery: list folders & files)
        v
   Presigned URL Generation (secure, temporary access)
        |
        | (Audio fetch via HTTP)
        v
   OpenAI Whisper (speech-to-text transcription)
        |
        | (Transcript text)
        v
   OpenAI GPT-4 (sentiment classification + summary)
        |
        | (JSON: sentiment, score, keywords, summary)
        v
   MongoDB (persistent storage)
        |
        | (Query & aggregate)
        v
   Next.js Dashboard (charts, tables, daily AI summaries)
```

### Step-by-step:

1. **A phone call happens** on the 3CX PBX system
2. **3CX records the call** as a `.wav` file on disk
3. **An external process** (not part of this app) syncs those recordings to an **AWS S3 bucket**, organized into date folders like `2025-12-10/`
4. **The app discovers recordings** by listing S3 folders and files
5. **For each recording**, the app generates a presigned URL, downloads the audio, and sends it to **OpenAI Whisper** for transcription
6. **The transcript** is then sent to **GPT-4** which returns sentiment (positive/negative/neutral), a score (-1 to +1), keywords, and a summary
7. **Results are stored** in MongoDB with the S3 key as a unique identifier
8. **The dashboard** displays everything: per-call analysis, agent performance tables, and AI-generated daily summaries

---

## 3. Tech Stack - What We Use and Why

### Core Framework: Next.js 14 (App Router)

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **Next.js 14** | Full-stack React framework; API routes + SSR + client components in one project. App Router gives us server components and route handlers. | **Express.js + separate React frontend** (more setup), **Remix** (similar capabilities), **SvelteKit** (different ecosystem) |

### AI/ML: OpenAI (Whisper + GPT-4)

| Component | Model | Purpose | Why This Choice |
|-----------|-------|---------|-----------------|
| **Transcription** | `whisper-1` | Convert `.wav` audio to English text | Industry-leading accuracy for phone call audio, handles accents and background noise well, simple API |
| **Sentiment Analysis** | `gpt-4` | Classify sentiment, extract keywords, generate summaries | Understands nuance and context far better than rule-based systems; returns structured JSON |
| **Daily Summaries** | `gpt-4` | Generate management-readable daily reports | Can synthesize 50+ call summaries into coherent bullet points with specific numbers |

#### Alternatives for Transcription

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| **AWS Transcribe** | Native AWS, good for batch jobs | Slower (async), more complex setup, separate billing | We already use OpenAI; Whisper is simpler for real-time |
| **Google Speech-to-Text** | Very accurate, supports streaming | Another cloud provider to manage, pricing per minute | Added complexity for no significant benefit |
| **Azure Cognitive Services** | Good enterprise support | Microsoft lock-in, another API to manage | Not needed |
| **Local Whisper (self-hosted)** | Free after hardware, no data leaves your network | Requires GPU, slower, maintenance burden | Cloud simplicity preferred |

#### Alternatives for Sentiment

| Alternative | Pros | Cons | Why Not |
|-------------|------|------|---------|
| **AWS Comprehend** | Purpose-built sentiment API | Only gives sentiment + score, no summaries or keywords in context | GPT-4 gives richer output (keywords, summary, nuanced scoring) |
| **VADER (Python library)** | Free, fast, no API calls | Rule-based, poor with sarcasm/complex language | Too simplistic for real customer calls |
| **TextBlob** | Simple Python library | Basic polarity only | No contextual understanding |
| **Hugging Face models** | Open source, customizable | Need to host/maintain, less accurate out-of-box | Maintenance overhead |
| **Google Cloud NLP** | Good entity/sentiment analysis | Another vendor, less flexible output | GPT-4 is more versatile |

**Why GPT-4 specifically?** It gives us four things in one API call that would otherwise require multiple services:

1. Sentiment classification (positive/negative/neutral)
2. Numerical score (-1 to +1)
3. Topic extraction (up to 5 keywords)
4. Natural language summary (max 50 words)

---

### Storage: AWS S3

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **AWS S3** | 3CX already syncs recordings here; cheap, durable, scalable object storage | **Azure Blob Storage**, **Google Cloud Storage**, **MinIO** (self-hosted S3-compatible) |

**S3 Structure:**

```
s3://3cx-ippbx/
  ├── 2025-12-08/
  │   ├── [Varia, Nick]_1004-+19094411808_20251208101530(12).wav
  │   ├── [Smith, John]_1002-+18005551234_20251208113045(15).wav
  │   └── ...
  ├── 2025-12-09/
  │   └── ...
  └── 2025-12-10/
      └── ...
```

**Filename format:** `[Agent_Name]_extension-destination_YYYYMMDDhhmmss(sequence).wav`

The filename itself is parsed by regex to extract: agent name, extension number, phone number, and call timestamp. This is done in `lib/s3-client.ts`:

```typescript
const match = filename.match(/\[(.+?)\]_(\d+)-(.+?)_(\d+)\((\d+)\)\.wav/);

if (match) {
  return {
    agentName: match[1],
    extension: match[2],
    destination: match[3],
    timestamp: match[4], // Format: YYYYMMDDHHMMSS
    sequence: match[5],
  };
}
```

---

### Database: MongoDB (for sentiment data)

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **MongoDB** | Flexible schema for analysis documents; each call can have different fields (analyzed vs skipped); good for aggregation queries | **PostgreSQL** (already used for 3CX CDR data but relational schema is rigid), **Elasticsearch** (overkill), **DynamoDB** (vendor lock-in) |

**Why not PostgreSQL?** The project already uses PostgreSQL for 3CX call data records (`cdrrecordings`, `recordings_view`), but sentiment data has a variable schema (some records are analyzed with full transcripts, some are skipped with just a reason). MongoDB's document model handles this naturally.

**Two MongoDB Collections:**

#### Collection 1: `sentiment_analysis` (one document per call recording)

```json
{
  "s3Key":            "2025-12-10/[Agent]_1004-...(77).wav",
  "s3Bucket":         "3cx-ippbx",
  "filename":         "[Agent]_1004-...(77).wav",
  "agentName":        "Varia, Nick",
  "extension":        "1004",
  "phoneNumber":      "+19094411808",
  "callTime":         "2025-12-10T12:51:48Z",
  "fileSize":         245760,

  "transcript":       "Hi, I'm calling about my appointment...",
  "transcriptLength": 847,

  "sentiment":        "positive",
  "sentimentScore":   0.72,
  "keywords":         ["appointment", "scheduling", "follow-up"],
  "summary":          "Patient called to confirm upcoming appointment and was satisfied with the scheduling.",

  "analyzedAt":       "2025-12-10T13:05:00Z",
  "processingTime":   8432,

  "skipped":          false,
  "skipReason":       null,
  "skippedAt":        null
}
```

#### Collection 2: `daily_summaries` (one document per date + filter combination)

```json
{
  "date":             "2025-12-10",
  "agentFilter":      null,
  "queueFilter":      null,
  "summary":          "**Main Problems:**\n• 12 patients reported...",
  "totalCalls":       87,
  "positiveCount":    52,
  "negativeCount":    18,
  "neutralCount":     17,
  "averageScore":     0.34,
  "generatedAt":      "2025-12-10T18:00:00Z",
  "isFinal":          true,
  "transcriptSample": "Patient upset about wait time | ..."
}
```

---

### Secrets Management: HashiCorp Vault

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **HashiCorp Vault** | Centralized secret management; OpenAI can be enabled/disabled via Vault without redeployment | **AWS Secrets Manager**, **Azure Key Vault**, plain `.env` files |

The `isOpenAIEnabled()` function in `lib/vault.ts` checks Vault for the `OPENAI_ENABLED` flag. If Vault is down, it falls back to the `OPENAI_ENABLED` environment variable. This is a kill switch for the entire AI pipeline.

---

## 4. The Analysis Pipeline (Deep Technical Detail)

### 4a. The GPT-4 Sentiment Prompt

This is the exact system prompt sent to GPT-4 for each call:

```
You are a sentiment analysis expert. Analyze the following call transcript and provide:
1. Overall sentiment (positive, negative, or neutral)
2. Sentiment score (-1 to 1, where -1 is very negative, 0 is neutral, 1 is very positive)
3. Key topics or keywords discussed (max 5)
4. A brief summary (max 50 words)

Respond in JSON format:
{ "sentiment": "positive|negative|neutral", "score": number, "keywords": ["keyword1", "keyword2"], "summary": "brief summary" }
```

**Temperature: 0.3** - Low temperature means more deterministic/consistent results. We want the same call to get roughly the same sentiment every time.

**Max tokens: 500** - The JSON response is small; this prevents runaway generation.

### 4b. File Validation (Before Transcription)

Before spending money on Whisper API calls, the system validates each file:

| Check | Threshold | Action |
|-------|-----------|--------|
| File too small | < 1 KB | Skip, store reason in DB |
| File too large | > 25 MB | Skip (OpenAI's hard limit) |
| Audio too short | < 0.1 seconds (Whisper error) | Catch error, skip, store reason |
| HTTP 413 from OpenAI | File exceeded upload limit | Catch error, skip, store reason |
| Already analyzed | `s3Key` exists in MongoDB | Skip immediately |

### 4c. Batch Processing

Files are processed in **batches of 5** (the `BATCH_SIZE` constant). Within each batch, all 5 files are processed in parallel using `Promise.all()`. Then the next batch starts. This balances speed against OpenAI rate limits.

---

## 5. The Auto-Analyzer (Background Worker)

The system has an automatic analysis mode that runs without user intervention.

**How it starts:** The root layout (`app/layout.tsx`) triggers the worker on page load and every 2 minutes:

```
layout.tsx loads
  → POST /api/sentiment-analysis/auto-analyze/worker (after 2s delay)
  → Repeats every 2 minutes via setInterval
```

**Worker logic** (`auto-analyze/worker/route.ts`):

1. Checks an in-memory lock (only one worker at a time)
2. Enforces 30-second minimum between runs
3. Lists the latest 5 S3 date folders
4. For each folder, calls `batch-check` to find unanalyzed files
5. Sends batches of 10 files to `/api/sentiment-analysis/analyze`
6. Has retry logic: 3 retries with exponential backoff for transient failures
7. 5-minute timeout per batch

**There is no external queue system** (no Bull, no SQS, no Redis queue). Everything runs in-process within the Next.js server. This is simpler but means analysis stops if the server restarts.

---

## 6. The Daily Summary Feature

When a user views a date, the system can generate an AI summary of all calls. This uses GPT-4 with a detailed prompt that includes:

- Call statistics (total, positive count, negative count, percentages)
- Agent performance breakdown
- Up to 20 negative call summaries
- Up to 20 positive call summaries

The output is structured as: **Main Problems**, **Positive Highlights**, **Key Takeaways**, **Recommendations**.

### Smart Caching Logic

- Summaries are cached in MongoDB's `daily_summaries` collection
- If stats haven't changed, the cached version is returned
- If marked as `isFinal` (all calls processed), it is **never** regenerated even with `forceRegenerate`
- Only regenerates if changes are "significant" (>=10% change in total OR >=3 change in sentiment counts)

---

## 7. All 14 API Endpoints

| # | Method | Endpoint | What It Does |
|---|--------|----------|-------------|
| 1 | GET | `/api/sentiment-analysis/s3-folders` | Lists all date folders in S3 bucket |
| 2 | GET | `/api/sentiment-analysis/s3-files?folder=YYYY-MM-DD` | Lists all `.wav` files in a date folder |
| 3 | POST | `/api/sentiment-analysis/analyze` | Core pipeline: transcribe + analyze batch of files |
| 4 | GET | `/api/sentiment-analysis/stats?folder=YYYY-MM-DD` | Aggregated statistics from MongoDB |
| 5 | POST | `/api/sentiment-analysis/batch-check` | Check analysis status for multiple S3 keys at once |
| 6 | GET | `/api/sentiment-analysis/analyzed-calls?date=&agent=` | Fetch analyzed calls filtered by date/agent |
| 7 | GET | `/api/sentiment-analysis/get-analysis?s3Key=` | Get analysis for a single recording |
| 8 | POST | `/api/sentiment-analysis/daily-summary` | Generate or return cached AI daily summary |
| 9 | GET | `/api/sentiment-analysis/remove-duplicates` | Check for duplicate records |
| 10 | POST | `/api/sentiment-analysis/remove-duplicates` | Remove duplicate records |
| 11 | GET | `/api/sentiment-analysis/auto-analyze` | List files pending analysis |
| 12 | POST | `/api/sentiment-analysis/auto-analyze/worker` | Run the auto-analysis worker |
| 13 | GET | `/api/sentiment-analysis/auto-analyze/control` | Get auto-analyzer status |
| 14 | POST | `/api/sentiment-analysis/auto-analyze/control` | Start/stop auto-analyzer |

---

## 8. The Dashboard UI

### Main Page (`/sentiment-analysis`)

**Features:**

- **Calendar view** with color-coded date statuses (green = complete, yellow = in progress, red = not started, gray = no calls)
- **Metric cards**: Total Analyzed, Positive, Negative, Neutral, Skipped (with counts and percentages)
- **Agent performance table**: Sortable by agent name, total calls, positive/negative/neutral count, average score. Exportable to CSV.
- **Call list**: Each call shows sentiment badge, phone number, agent, summary, and call time. Clickable to see full transcript and keywords.
- **AI Daily Summary**: Bullet-point management report with Main Problems, Highlights, Takeaways, Recommendations
- **Filters**: By date, agent, sentiment type, and free-text search
- **Auto-refresh**: Polls every 30 seconds when enabled

**Styling:** Fluent Design tokens (Microsoft-inspired), Lucide icons, Tailwind CSS.

### Embed Page (`/embed/sentiment-analysis`)

A simplified, iframe-embeddable version showing:

- 4 stat cards (Total, Positive, Negative, Neutral)
- Recent analyses list
- Uses `postMessage` bridge for parent-iframe communication
- Authenticated via embed token

---

## 9. Authentication & Security

| Layer | Mechanism |
|-------|-----------|
| **Main dashboard** | Session-based auth via `AuthCheck` component |
| **API endpoints** | Session cookie validation |
| **Embed pages** | JWT embed token (`lib/embed-auth.ts`) with `sentiment` permission |
| **S3 access** | AWS IAM credentials (access key + secret key) |
| **OpenAI** | API key stored in env / Vault |
| **Secrets** | HashiCorp Vault with 5-minute TTL cache |
| **Rate limiting** | Middleware-level rate limiting on API routes |

---

## 10. Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Authentication for Whisper + GPT-4 |
| `OPENAI_ENABLED` | Kill switch (`true`/`false`) |
| `OPENAI_MODEL` | Model override (defaults to `gpt-4`) |
| `AWS_ACCESS_KEY_ID` | S3 authentication |
| `AWS_SECRET_ACCESS_KEY` | S3 authentication |
| `AWS_REGION` | S3 region |
| `AWS_S3_BUCKET` | Bucket name (e.g., `3cx-ippbx`) |
| `MONGODB_URI` | MongoDB connection string |
| `VAULT_ADDR` | HashiCorp Vault URL |
| `VAULT_TOKEN` | Vault authentication token |
| `NEXT_PUBLIC_BASE_URL` | Base URL for internal API calls from the worker |
| `DB_HOST/USER/PASSWORD/NAME/PORT` | PostgreSQL (for 3CX CDR data) |

---

## 11. Cost Considerations

| Service | Pricing Model | Estimate |
|---------|--------------|----------|
| **Whisper** | ~$0.006 per minute of audio | A 5-minute call = ~$0.03 |
| **GPT-4** | ~$0.03/1K input tokens, ~$0.06/1K output tokens | ~$0.02-0.05 per call analysis |
| **GPT-4 Daily Summary** | Same as above | ~$0.10-0.20 per summary |
| **S3 Storage** | ~$0.023/GB/month | Negligible for audio files |
| **MongoDB** | Depends on hosting (Atlas free tier works for small scale) | Varies |

**For 100 calls/day:** roughly $5-8/day in OpenAI costs.

---

## 12. Key Design Decisions & Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| **OpenAI over self-hosted** | Simpler, no GPU management, better accuracy | Ongoing API cost, data leaves your network |
| **MongoDB over PostgreSQL for sentiment** | Flexible schema for analyzed vs skipped records | Two databases to maintain |
| **In-process worker over job queue** | No additional infrastructure (Redis/SQS) | Analysis stops on server restart |
| **Batch of 5 files** | Balances parallelism vs OpenAI rate limits | Could be faster with higher limits |
| **S3 presigned URLs** | Secure, temporary access; audio never stored locally | URLs expire (1 hour TTL) |
| **`s3Key` as unique index** | Natural deduplication; same file never analyzed twice | Tied to S3 structure |
| **Daily summary caching with `isFinal`** | Prevents expensive regeneration when all calls are done | Slightly stale if edge cases |
| **WAV only** | 3CX outputs WAV; no conversion needed | Can't handle MP3/other formats |

---

## 13. Complete File Map

### API Routes (`app/api/sentiment-analysis/`)

| File | Purpose |
|------|---------|
| `analyze/route.ts` | Main pipeline: transcribe audio + GPT-4 sentiment |
| `s3-folders/route.ts` | List date folders in S3 |
| `s3-files/route.ts` | List WAV files in a date folder |
| `stats/route.ts` | Aggregate stats from MongoDB |
| `batch-check/route.ts` | Check which S3 keys are analyzed/skipped |
| `analyzed-calls/route.ts` | Fetch analyzed calls by date/agent |
| `get-analysis/route.ts` | Get analysis for a single S3 key |
| `daily-summary/route.ts` | Generate AI daily summary via GPT-4 |
| `remove-duplicates/route.ts` | Detect and remove duplicate records |
| `auto-analyze/route.ts` | List unanalyzed files |
| `auto-analyze/worker/route.ts` | Background worker for auto-analysis |
| `auto-analyze/control/route.ts` | Start/stop auto-analyzer |

### UI Pages

| File | Purpose |
|------|---------|
| `app/sentiment-analysis/page.tsx` | Main sentiment dashboard (~3,682 lines) |
| `app/embed/sentiment-analysis/page.tsx` | Embeddable sentiment dashboard |

### Libraries & Utilities

| File | Purpose |
|------|---------|
| `lib/mongodb.ts` | MongoDB connection + `getSentimentCollection()` |
| `lib/s3-client.ts` | S3 client, presigned URLs, filename parsing |
| `lib/vault.ts` | HashiCorp Vault + `isOpenAIEnabled()` |
| `lib/embed-auth.ts` | Embed token generation/validation |
| `lib/export-utils.ts` | CSV/JSON export for agent performance |

### Supporting Components

| File | Purpose |
|------|---------|
| `components/Sidebar.tsx` | Nav item for `/sentiment-analysis` |
| `components/AuthCheck.tsx` | Session auth wrapper |
| `components/SortableTableHeader.tsx` | Sortable column headers for agent table |
| `app/layout.tsx` | Triggers auto-analyze worker periodically |

---

## 14. Potential Questions and Answers

**Q: What happens if OpenAI is down?**
A: Analysis fails gracefully. The file is marked as failed (not skipped), so it will be retried on the next worker run. The dashboard still shows previously analyzed data from MongoDB.

**Q: What about data privacy? Call audio goes to OpenAI?**
A: Yes, audio is sent to OpenAI's API for transcription. OpenAI's data usage policy applies. For stricter privacy, you could switch to self-hosted Whisper, but that requires GPU infrastructure.

**Q: How long does analysis take per call?**
A: Typically 5-15 seconds per call (Whisper transcription ~3-8s + GPT-4 analysis ~2-5s). With batches of 5, that's about 100 calls in 3-5 minutes.

**Q: Can it handle multiple languages?**
A: Currently hardcoded to English (`language: 'en'` in the Whisper call). Whisper supports 57+ languages - just change or remove the language parameter.

**Q: What if the same file is analyzed twice?**
A: The `s3Key` unique index in MongoDB prevents duplicates. The `upsert: true` operation means re-analysis overwrites the old result. There's also a dedicated `remove-duplicates` endpoint for cleanup.

**Q: Why not use AWS Comprehend instead of GPT-4?**
A: AWS Comprehend gives only sentiment + score. GPT-4 gives sentiment + score + keywords + summary in one call. The summary and keywords are crucial for the daily report and agent coaching.

**Q: What if the S3 bucket structure changes?**
A: The system expects `YYYY-MM-DD/` folders with `.wav` files following the `[Agent]_ext-dest_timestamp(seq).wav` naming convention. Any change to this structure requires updating the S3 listing logic and the filename regex parser.

**Q: How does the system handle very long calls?**
A: Whisper has a 25MB file size limit. Calls exceeding this are automatically skipped with a reason stored in the database. For typical phone call audio quality, 25MB translates to roughly 45-60 minutes of audio.

**Q: Is there a way to re-analyze a specific call?**
A: Yes, the analyze endpoint uses `upsert: true` on the MongoDB document. Sending the same file for analysis again will overwrite the previous result.

**Q: What database indexes exist?**
A: The `sentiment_analysis` collection has a unique index on `s3Key`, ensuring one document per recording. The `daily_summaries` collection uses a compound key of `date` + `agentFilter` + `queueFilter`.

---

## 15. Architecture Summary

The core innovation is the **single-pipeline approach**: one API call to Whisper for transcription, one to GPT-4 for rich multi-dimensional analysis (not just positive/negative, but keywords, score, and a human-readable summary), all stored in MongoDB and surfaced through a real-time dashboard with AI-generated daily intelligence reports.

**Key numbers:**
- **14** API endpoints
- **2** MongoDB collections
- **2** AI models (Whisper + GPT-4)
- **5** files per analysis batch
- **2-minute** auto-analyzer interval
- **30-second** minimum between worker runs
- **6-hour** date status cache
- **1-hour** presigned URL expiry
- **5-minute** Vault cache TTL
