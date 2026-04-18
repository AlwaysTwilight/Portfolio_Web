# MedinovAI Chatbot (Carevio) — Complete Project Documentation

> **Last Updated:** March 12, 2026
> **Purpose:** End-to-end technical reference for presentation and Q&A preparation

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Tech Stack — What, Why, and Alternatives](#3-tech-stack--what-why-and-alternatives)
4. [LangGraph — The Conversation Engine](#4-langgraph--the-conversation-engine)
5. [RAG System — How Knowledge Is Stored and Retrieved](#5-rag-system--how-knowledge-is-stored-and-retrieved)
6. [Embeddings — What, Why, and How](#6-embeddings--what-why-and-how)
7. [Semantic QA Cache — Cost Optimization Layer](#7-semantic-qa-cache--cost-optimization-layer)
8. [Token Management and Context Window Strategy](#8-token-management-and-context-window-strategy)
9. [Smart Model Routing — Fast vs Thinking Models](#9-smart-model-routing--fast-vs-thinking-models)
10. [Prompt Engineering System](#10-prompt-engineering-system)
11. [Chat Widget — Customer-Facing Frontend](#11-chat-widget--customer-facing-frontend)
12. [Dashboard — Admin Panel](#12-dashboard--admin-panel)
13. [Human Agent Escalation Flow](#13-human-agent-escalation-flow)
14. [Mattermost Integration](#14-mattermost-integration)
15. [3CX PBX Presence Integration](#15-3cx-pbx-presence-integration)
16. [Redis — Caching, Sessions, and Real-Time](#16-redis--caching-sessions-and-real-time)
17. [MongoDB — Primary Database](#17-mongodb--primary-database)
18. [Authentication and Security](#18-authentication-and-security)
19. [All Services — Complete Catalog](#19-all-services--complete-catalog)
20. [All API Routes — Complete Catalog](#20-all-api-routes--complete-catalog)
21. [Middleware Stack](#21-middleware-stack)
22. [Data Models](#22-data-models)
23. [Utility Modules](#23-utility-modules)
24. [Deployment Architecture](#24-deployment-architecture)
25. [Environment Variables](#25-environment-variables)
26. [End-to-End Data Flow](#26-end-to-end-data-flow)
27. [Key Design Decisions and Reasoning](#27-key-design-decisions-and-reasoning)
28. [Directory Structure](#28-directory-structure)

---

## 1. Project Overview

### What Is This?

**Carevio** is an AI-powered customer service chatbot built for **myOnsite Healthcare**, a nationwide mobile phlebotomy company in the United States. The system consists of three main components:

1. **Chat Widget** — A vanilla JavaScript widget that can be embedded on any website
2. **FastAPI Backend** — Python-based AI backend with LangGraph conversation engine
3. **Admin Dashboard** — React-based real-time monitoring and agent intervention panel

### What Does It Do?

- Answers questions about myOnsite Healthcare services, insurance, and coverage areas
- Schedules mobile phlebotomy appointments (collecting ZIP, date, time, service, name, email, phone, insurance)
- Escalates conversations to human agents when requested or when AI cannot help
- Provides real-time dashboards for agents and managers to monitor all conversations
- Forwards conversations to Mattermost for agent communication
- Checks agent availability via 3CX phone system integration
- Performs sentiment analysis on conversations
- Generates analytics and reports

### What It Does NOT Do

- No medical advice — strictly scheduling and information
- No diagnosis or treatment recommendations
- Directs emergencies to 911 immediately

### The Company: myOnsite Healthcare

- **Business:** Mobile phlebotomy (blood draw at patient location)
- **Coverage:** All 50 US states
- **CEO:** Mayank Trivedi
- **Phone:** (941) 271-0701, toll-free (877) 686-4440
- **Fax:** (877) 471-1327, (949) 596-0903
- **Email:** info@myonsitehealthcare.com, orders@myonsitehealthcare.com
- **Services:** Mobile phlebotomy, lab testing, anticoagulation/INR monitoring, clinical trials, events/corporate wellness, legal/DNA testing, provider services
- **Insurance:** Medicare, Tricare, UHC/Optum, Aetna, Humana, Cigna, BCBS, and more
- **Scheduling:** Same-day and next-day appointments available

---

## 2. Architecture Overview

```
┌──────────────────────┐       ┌──────────────────────────────────────────────┐
│   Patient on         │       │              Agent Dashboard                  │
│   Website            │       │   React 18 + TypeScript + Keycloak SSO       │
│   ┌────────────────┐ │       │   Socket.IO for real-time updates             │
│   │  Chat Widget   │ │       │              Port 3006                       │
│   │  (Vanilla JS)  │ │       └──────────────────┬───────────────────────────┘
│   └───────┬────────┘ │                          │
└───────────┼──────────┘                          │
            │ HTTP + WebSocket                    │ HTTP + WebSocket
            ▼                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Port 8007)                                │
│   Socket.IO server with Redis adapter for cross-worker messaging             │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────┐     │
│   │  LangGraph Conversation Pipeline                                    │     │
│   │  router → rag_node → general_chat (OpenAI LLM) → post_process      │     │
│   └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│   │ Mattermost   │  │ 3CX PBX      │  │ Agent         │  │ Dashboard    │  │
│   │ Service      │  │ Presence     │  │ Escalation    │  │ Sync Service │  │
│   └──────────────┘  └──────────────┘  └───────────────┘  └──────────────┘  │
└──────┬───────────────────┬────────────────────┬──────────────────────────────┘
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────┐     ┌─────────────┐      ┌─────────────┐
│   MongoDB   │     │    Redis    │      │  ChromaDB   │
│  (primary   │     │  (cache,    │      │  (vector    │
│   database) │     │   sessions, │      │   search,   │
│             │     │   pub/sub,  │      │   RAG,      │
│  External   │     │   locks)    │      │   QA cache) │
│  hosted     │     │  Port 6383  │      │  Port 8003  │
└─────────────┘     └─────────────┘      └─────────────┘
```

### Communication Patterns

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| Chat Widget | Backend | HTTP POST + WebSocket | Send/receive messages |
| Dashboard | Backend | HTTP + Socket.IO | REST API + real-time events |
| Backend | MongoDB | TCP (pymongo/motor) | Data persistence |
| Backend | Redis | TCP (aioredis) | Caching, sessions, pub/sub |
| Backend | ChromaDB | HTTP | Vector similarity search |
| Backend | OpenAI | HTTPS | LLM inference |
| Backend | Mattermost | HTTP + WebSocket | Agent handoff messaging |
| Backend | 3CX | HTTPS | Agent presence checks |

---

## 3. Tech Stack — What, Why, and Alternatives

### 3.1 Backend Framework

| Choice | Version | Why | Alternatives Considered |
|--------|---------|-----|------------------------|
| **FastAPI** | 0.104 | Async-native Python framework; automatic OpenAPI documentation; Pydantic request/response validation; first-class WebSocket support; ideal for AI/ML Python ecosystem where most LLM libraries are Python | **Flask** — simpler but no native async support, would need Celery for background tasks. **Django** — heavier, ORM-focused, not ideal for API-only services. **Express.js (Node.js)** — would require separate microservices for Python AI code. **Starlette** — lower-level, FastAPI is built on it anyway. |

**Why Python specifically?** The entire AI/ML ecosystem (OpenAI SDK, LangChain, LangGraph, sentence-transformers, ChromaDB client, tiktoken) is Python-first. Using another language would mean wrapping Python libraries or using inferior ports.

### 3.2 ASGI Server

| Choice | Version | Why | Alternatives |
|--------|---------|-----|-------------|
| **Uvicorn** | 0.24 | High-performance ASGI server; supports HTTP/1.1 and WebSockets; works perfectly with FastAPI; single-worker mode for Socket.IO compatibility | **Gunicorn + UvicornWorker** — better for multi-worker but complicates Socket.IO state. **Daphne** — Django-focused. **Hypercorn** — similar to Uvicorn but less community support. |

### 3.3 AI/LLM Provider

| Choice | Models Used | Why | Alternatives |
|--------|-------------|-----|-------------|
| **OpenAI** | gpt-4o-mini (fast), o3-mini (thinking), gpt-4-1106-preview (default) | Best-in-class reasoning, reliable function/tool calling, structured JSON output, extensive documentation, 99.9% uptime SLA | **Anthropic Claude** — good reasoning but less mature tool calling at project start; API key is in env as backup. **Google Gemini** — cheaper but less reliable for structured output. **Llama 3 (self-hosted)** — no API costs but requires GPU infrastructure and more latency. **Mistral** — good value but smaller model ecosystem. |

### 3.4 LLM Orchestration Framework

| Choice | Version | Why | Alternatives |
|--------|---------|-----|-------------|
| **LangGraph** | (via langchain 0.1.0) | Stateful conversation graphs with conditional branching; built-in MongoDB checkpointer for conversation persistence; tool-calling loops (LLM calls tool → gets result → reasons again); visualizable flow; supports async | **LangChain (chains only)** — linear execution, no branching or loops. **Raw OpenAI API** — no state management, no tool loop, must build everything manually. **Semantic Kernel (Microsoft)** — tied to Microsoft ecosystem. **CrewAI** — multi-agent focus, overkill for single-bot. **AutoGen** — conversation-focused but less flexible routing. |

**Why LangGraph over plain LangChain?** LangChain chains are linear (A → B → C). LangGraph is a state machine — the conversation can branch (greeting vs appointment vs RAG), loop (LLM calls tool → gets result → calls another tool), and persist state across requests via MongoDB checkpointer.

### 3.5 Vector Database

| Choice | Version | Why | Alternatives |
|--------|---------|-----|-------------|
| **ChromaDB** | 0.4.22 | Python-native; lightweight HTTP API; Docker-ready; cosine similarity built-in; free and self-hosted; sufficient for our dataset size (hundreds of documents, not millions) | **Pinecone** — managed cloud service, better for massive scale, but data leaves our infrastructure and costs money. **Weaviate** — heavier, more features than needed. **Qdrant** — Rust-based, faster at scale, but more complex setup. **FAISS** — no built-in persistence (code has FAISS fallback commented out). **pgvector** — would work if already using PostgreSQL, but we use MongoDB. **Milvus** — enterprise-grade, overkill for our scale. |

### 3.6 Embedding Models

| Model | Dimensions | Used Where | Why |
|-------|-----------|------------|-----|
| **all-MiniLM-L6-v2** (SentenceTransformer) | 384 | VectorDB (RAG collections, QA cache embedding generation) | Free, runs locally, fast inference, good quality for semantic search, no API costs per embedding | 
| **text-embedding-3-small** (OpenAI) | 1536 | Configured in env but VectorDB uses local model | Higher quality but costs $0.02/1M tokens |

**Why local embedding model?** Every message and every RAG query needs embeddings. Using OpenAI embeddings would add latency (network round-trip) and cost. `all-MiniLM-L6-v2` runs in-process with <10ms latency and zero cost. Trade-off: slightly lower quality than OpenAI embeddings, but sufficient for our FAQ/company knowledge use case.

**Alternative embedding models:** `all-mpnet-base-v2` (768d, better quality, slower), `bge-small-en` (384d, newer), `nomic-embed-text` (768d, good quality), OpenAI `text-embedding-3-large` (3072d, best quality, most expensive).

### 3.7 Primary Database

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **MongoDB** | Schema-flexible for conversations (messages vary in structure); document model fits chat data naturally; supports LangGraph's `MongoDBSaver` checkpointer; good async driver (motor); handles both structured (users) and unstructured (chat messages) data | **PostgreSQL** — better ACID, but rigid schema for varied message formats; would need JSONB columns. **DynamoDB** — pay-per-use, managed, but vendor lock-in. **Firestore** — Firebase ecosystem, not self-hosted. **CouchDB** — similar to MongoDB but smaller ecosystem. |

### 3.8 Cache and Session Store

| Choice | Version | Why | Alternatives |
|--------|---------|-----|-------------|
| **Redis** | 7-alpine | Sub-millisecond reads for real-time chat sessions; pub/sub for Socket.IO multi-worker adapter; atomic SETNX for agent claim locks; rate limiting counters; TTL-based session expiry | **Memcached** — faster for simple caching but no pub/sub, no persistence, no data structures. **In-memory dict** — used as fallback, but no persistence and single-process only. **KeyDB** — Redis fork, compatible but less tested. **Valkey** — Redis fork post-license change. |

### 3.9 Real-Time Communication

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **Socket.IO** (python-socketio + socket.io-client) | Bidirectional real-time messaging; room support for conversation channels; automatic reconnection; fallback to long-polling if WebSocket fails; Redis adapter for multi-worker; both Python server and JS client libraries | **Raw WebSockets** — no rooms, no auto-reconnect, no fallback, must build protocol yourself. **Server-Sent Events (SSE)** — server-to-client only, no bidirectional. **gRPC streaming** — overkill, requires protobuf. **Pusher/Ably** — managed services, costs money, data leaves infra. |

### 3.10 Authentication

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **Keycloak** | Open-source SSO/IAM; self-hosted (data stays on-prem); OIDC/SAML support; RBAC built-in; realm management for multi-tenant; already part of company infrastructure | **Auth0** — managed, easier setup, but expensive at scale ($23/1K users/mo). **Firebase Auth** — simpler but less control, Google-dependent. **Supabase Auth** — good but tied to Supabase. **Custom JWT** — more flexibility but must build everything (password hashing, token refresh, RBAC). |

### 3.11 Dashboard Frontend

| Choice | Version | Why | Alternatives |
|--------|---------|-----|-------------|
| **React 18** | 18.x | Industry standard; huge component ecosystem; strong TypeScript support; large developer pool | **Next.js** — SSR not needed for admin dashboard. **Vue.js** — smaller ecosystem. **Angular** — heavier, more opinionated. **Svelte** — less mature ecosystem for enterprise. |
| **TypeScript** | 5.x | Type safety catches bugs at compile time; better IDE support; self-documenting | Plain JavaScript — no type checking. |
| **Vite** | 5.x | 10-100x faster than Webpack for dev builds; native ES modules; HMR in milliseconds | **Webpack** — slower, more complex config. **Parcel** — less configurable. |
| **Tailwind CSS** | 3.x | Utility-first; rapid prototyping; consistent design system; small bundle (purges unused) | **Material UI** — opinionated, large bundle. **Chakra UI** — good but another dependency. **Styled Components** — more boilerplate. |
| **Recharts** | — | React-native charting; declarative API; good for dashboards | **Chart.js** — imperative API, harder with React. **D3** — too low-level. |

### 3.12 Chat Widget Frontend

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **Vanilla JavaScript + HTML + CSS** | Zero dependencies; embeddable on any website via single `<script>` tag; tiny bundle size; works regardless of host site's framework; no build step needed | **React widget** — would require React runtime on host site or iframe. **Web Components** — browser support gaps. **Preact** — smaller but still a dependency. **iframe** — isolation but harder to style/position. |

### 3.13 Integrations

| Integration | Why | Alternatives |
|-------------|-----|-------------|
| **Mattermost** | Open-source Slack alternative; already used internally by agents; self-hosted (HIPAA-friendly); REST + WebSocket APIs; channel-per-conversation model | **Slack** — data leaves infrastructure, HIPAA concerns. **Microsoft Teams** — complex API, Microsoft dependency. **Custom built chat** — months of development. |
| **3CX PBX** | Company's existing phone system; REST API for presence (available/busy/on-call); checks agent availability before escalation | **Twilio** — cloud telephony, pay-per-use. **Asterisk** — open-source but harder API. **RingCentral** — managed, costly. |

### 3.14 Deployment

| Choice | Why | Alternatives |
|--------|-----|-------------|
| **Docker + Docker Compose** | Reproducible builds; multi-service orchestration; isolation; easy local development; single command deployment | **Kubernetes** — overkill for current scale (4 containers). **AWS ECS/Fargate** — managed but vendor lock-in. **Bare metal** — no isolation, dependency conflicts. **Podman** — Docker-compatible but less tooling. |

---

## 4. LangGraph — The Conversation Engine

### 4.1 What Is LangGraph?

LangGraph is a library from the LangChain team that lets you build **stateful, graph-based** conversation flows. Unlike simple chains (A → B → C), LangGraph allows:

- **Conditional branching** — Different paths based on user intent
- **Loops** — LLM calls a tool, gets result, reasons again, maybe calls another tool
- **State persistence** — Conversation state saved to MongoDB, restored on next message
- **Checkpointing** — Every step is checkpointed, enabling replay and debugging

### 4.2 Why LangGraph?

Without LangGraph, you would need to:
- Manually manage conversation state in Redis/MongoDB
- Build your own routing logic for intents
- Implement tool-calling loops manually
- Handle state persistence across HTTP requests yourself
- Build retry/error handling for each step

LangGraph provides all of this as infrastructure.

### 4.3 The Conversation Graph

```
                              START
                                │
                                ▼
                        ┌───────────────┐
                        │  router_node  │  Regex + context-based intent detection
                        └───────┬───────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │         │           │          │           │
          ▼         ▼           ▼          ▼           ▼
     ┌─────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐
     │greeting │ │appoint-  │ │edit/   │ │support │ │ai      │
     │node     │ │ment      │ │cancel  │ │(handoff│ │paused  │
     │         │ │trigger   │ │appoint │ │node)   │ │node    │
     └────┬────┘ └────┬─────┘ └───┬────┘ └───┬────┘ └───┬────┘
          │           │           │           │          │
          │           │           │           │        (END)
          │           │           │           │
          ▼           ▼           ▼           ▼
     ┌─────────────────────────────────────────────┐
     │              post_process_node               │
     │  • Clean emojis from response                │
     │  • Sync to dashboard via Socket.IO           │
     │  • Forward to Mattermost if agent watching   │
     │  • Cache Q&A pair in semantic cache           │
     │  • Run sentiment analysis                    │
     └──────────────────┬──────────────────────────┘
                        │
                       END

     For RAG intent (default path):

     router_node → rag_node → general_chat_node → [tool loop] → post_process_node → END

                    ┌──────────┐
                    │ rag_node │
                    │          │  1. Check Semantic QA Cache (ChromaDB)
                    │          │  2. If miss: query RAG knowledge base (ChromaDB)
                    │          │  3. Attach context to state
                    └────┬─────┘
                         │
                    ┌────────────────────┐
                    │ general_chat_node  │
                    │                    │  Call OpenAI with:
                    │                    │  • System prompt (master_prompts)
                    │                    │  • RAG context
                    │                    │  • Conversation history
                    │                    │  • Available tools
                    └────────┬───────────┘
                             │
                     ┌───────┴────────┐
                     │  Tool calls?   │
                     └───┬────────┬───┘
                    Yes  │        │  No
                         ▼        ▼
               ┌──────────────┐  post_process_node → END
               │tool_executor │
               │  node        │ Runs: check_zip, lookup_insurance, lookup_patient
               └──────┬───────┘
                      │
                      └──→ back to general_chat_node (loop)
```

### 4.4 Graph State Schema

Every message passing through the graph carries this state:

```python
class ChatState(MessagesState):     # Extends LangGraph's built-in message handling
    session_id: str                  # Unique session identifier
    messages: list                   # Full conversation history (inherited)
    intent: Optional[str]            # Detected intent (greeting, appointment, rag, support, etc.)
    collected_data: Optional[dict]   # Appointment data (name, phone, ZIP, etc.)
    appointment_active: Optional[bool]  # Whether appointment flow is in progress
    appointment_step: Optional[str]  # Current step in appointment flow
    ai_paused: Optional[bool]       # True when human agent has taken over
    mattermost_channel_id: Optional[str]  # Linked Mattermost channel
    rag_context: Optional[str]      # Retrieved knowledge context
    sentiment: Optional[str]        # Detected sentiment
    response_metadata: Optional[dict]  # Extra metadata
```

State is persisted via **MongoDB checkpointer** — when the same `session_id` sends another message, the full state is restored from the database automatically.

### 4.5 Available Tools (Function Calling)

The LLM can call these tools during conversation:

| Tool | Input | What It Does | Data Source |
|------|-------|-------------|-------------|
| `check_zip_serviceability` | 5-digit ZIP code | Validates if patient's ZIP is in the service area | External API (CommonGateway) |
| `lookup_insurance` | Provider name, optional state | Checks if insurance is accepted; returns plan types (HMO/PPO/POS) | Hardcoded list: Medicare, RR Medicare, Tricare West, UHC, Aetna, Humana, Cigna, BCBS |
| `lookup_patient` | Phone number or email | Looks up existing patient profile | MongoDB `patients` collection |

**Tool-calling loop:** If the LLM decides it needs to call a tool (e.g., user says "do you accept Aetna?"), the graph routes to `tool_executor_node`, runs the tool, feeds the result back to `general_chat_node`, and the LLM generates a final response incorporating the tool result.

### 4.6 Node Details

| Node | Function | Key Logic |
|------|----------|-----------|
| **router_node** | Intent detection | Regex patterns for greetings, appointment keywords, edit/cancel, support/human requests; checks Redis `ai_paused:{session_id}` flag |
| **rag_node** | Knowledge retrieval | Calls `SemanticQACache.get_cached_context()` first; if miss, calls `RAGService.query_docs()` with k=3; attaches context to state |
| **general_chat_node** | LLM inference | Builds system prompt from `master_prompts.OPTIMIZED_SYSTEM_PROMPT`; sends to OpenAI with conversation history + RAG context + tools bound |
| **tool_executor_node** | Tool execution | Runs whichever tool the LLM requested from `ALL_TOOLS` |
| **greeting_node** | Fixed welcome | Returns branded Carevio greeting message |
| **appointment_trigger_node** | Start appointment flow | Sets `appointment_active: True` in state |
| **edit_appointment_node** | Edit/cancel appointment | Asks user for their Appointment ID |
| **handoff_node** | Human escalation | Triggers `AgentEscalationService` → MongoDB + Redis + Socket.IO broadcast + Mattermost channel |
| **paused_node** | AI paused response | Returns message that a human agent is handling the conversation |
| **post_process_node** | Response cleanup | Emoji cleaning, dashboard sync, Mattermost forwarding, QA caching, sentiment analysis |

### 4.7 LangGraph Persistence

- **Checkpointer:** `MongoDBSaver` or `AsyncMongoDBSaver` connected to the same MongoDB instance
- **Database:** Same `MONGO_URI`, database name from `MONGO_DB_NAME`
- **Thread ID:** Uses `session_id` as the LangGraph thread identifier
- **What's persisted:** Full `ChatState` — all messages, collected data, intent, appointment state, etc.
- **Restoration:** When a returning user sends a message, the checkpointer loads the full state from MongoDB, so the LLM has the complete conversation history

---

## 5. RAG System — How Knowledge Is Stored and Retrieved

### 5.1 What Is RAG?

**Retrieval-Augmented Generation (RAG)** means: before asking the LLM a question, first search a knowledge base for relevant documents, then include those documents in the prompt. This way the LLM can answer questions about company-specific information that is not in its training data.

### 5.2 How Knowledge Is Stored

Knowledge is stored in **ChromaDB** (vector database) across these collections:

| Collection | Content | Seeded By |
|------------|---------|-----------|
| `medical_knowledge` | Medical/healthcare information | `scripts/populate_rag_knowledge.py` |
| `company_knowledge` | Company info, services, policies, FAQ | `scripts/seed_company_knowledge.py` |
| `faq_responses` | Frequently asked questions and answers | `scripts/seed_company_knowledge.py` |
| `intent_examples` | Example phrases for each intent category | `scripts/seed_intent_examples.py` |
| `appointment_context` | Appointment-related context | Setup scripts |
| `conversation_context` | Historical conversation context | Runtime caching |
| `qa_cache` | Semantic QA cache (question-answer pairs) | Runtime — populated automatically |

### 5.3 How Documents Are Chunked

Documents are split into chunks before being embedded and stored:

| Setting | Value | Source |
|---------|-------|--------|
| **Chunk size** | 1000 characters | `config.py → RAGConfig.CHUNK_SIZE` |
| **Chunk overlap** | 50 characters | `config.py → RAGConfig.CHUNK_OVERLAP` |
| **Splitter** | `RecursiveCharacterTextSplitter` | LangChain utility |
| **Length function** | `len` (character count, not tokens) | — |

**Why these values?** 1000-character chunks balance between having enough context per chunk and not exceeding the embedding model's optimal input length. 50-character overlap ensures sentences at chunk boundaries are not lost.

**Alternatives:** Semantic chunking (split by meaning, not fixed size), sentence-level chunking, paragraph-level chunking. Fixed-size is simpler and sufficient for company FAQ-style documents.

### 5.4 How Retrieval Works

```
User Question: "Do you accept Aetna insurance?"
         │
         ▼
┌────────────────────────────┐
│ 1. Generate embedding      │  all-MiniLM-L6-v2 → 384-dimensional vector
│    for the question        │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ 2. Search ChromaDB         │  Cosine similarity search across collections
│    collections             │  Returns top-k most similar documents
│    k = 3 (in LangGraph)   │
│    k = 4 (in legacy path) │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ 3. Filter by similarity    │  Minimum threshold: 0.7
│    threshold               │  Documents below this are discarded
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ 4. Format context          │  Max 2000 characters total
│    for LLM prompt          │  Each doc truncated to 500 chars
│                            │  Labeled with confidence (High/Medium/Low)
└────────────┬───────────────┘
             │
             ▼
  Injected into LLM system prompt as "RAG Context"
```

### 5.5 Context Type Classification

The RAG service classifies queries to search the right collections:

| Context Type | Triggered By Keywords | Collections Searched |
|-------------|----------------------|---------------------|
| `appointment` | schedule, appointment, book, date, time | `appointment_context` |
| `medical` | blood, test, lab, phlebotomy, sample | `medical_knowledge` |
| `company` | myonsite, hours, contact, insurance, service | `company_knowledge`, `faq_responses` |
| `general` | Everything else | All collections |

### 5.6 Multi-Collection Search

The `enhanced_rag_search()` function in `vector_db.py` searches across multiple collections simultaneously and merges results by similarity score. This ensures that a question about "scheduling a blood draw" finds both appointment context and medical knowledge.

---

## 6. Embeddings — What, Why, and How

### 6.1 What Are Embeddings?

Embeddings are numerical vector representations of text. Similar texts produce similar vectors. This enables "semantic search" — finding documents by meaning rather than keyword matching.

Example: "blood test" and "lab work" have similar embeddings even though they share no words.

### 6.2 Embedding Models Used

| Model | Provider | Dimensions | Speed | Quality | Cost | Used For |
|-------|----------|-----------|-------|---------|------|----------|
| **all-MiniLM-L6-v2** | HuggingFace (local) | 384 | ~5ms | Good | Free | RAG retrieval, QA cache similarity search |
| **text-embedding-3-small** | OpenAI API | 1536 | ~100ms | Better | $0.02/1M tokens | Configured in env but not actively used for embeddings |

### 6.3 Why all-MiniLM-L6-v2?

1. **Free** — No per-request cost; critical when every message generates embeddings
2. **Fast** — Runs locally in-process, ~5ms vs ~100ms for API call
3. **No network dependency** — Works even if OpenAI API is down
4. **Good enough** — For company FAQ and knowledge base (hundreds of documents), the quality difference vs OpenAI embeddings is negligible
5. **384 dimensions** — Smaller vectors = faster similarity search and less storage

### 6.4 How Embeddings Are Generated

```python
# In src/core/vector_db.py
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')

def generate_embeddings(texts: list[str]) -> list[list[float]]:
    embeddings = model.encode(texts)  # Returns numpy array of shape (n, 384)
    return embeddings.tolist()
```

### 6.5 Similarity Metric

ChromaDB is configured with **cosine similarity** (`hnsw:space: "cosine"`).

ChromaDB returns a "distance" (0 = identical, 2 = opposite). The code converts this to similarity: `similarity = 1 - distance`.

| Similarity | Meaning |
|-----------|---------|
| 1.0 | Identical |
| 0.92+ | High confidence match |
| 0.85+ | Good match (cache hit threshold) |
| 0.7+ | Acceptable match (RAG threshold) |
| < 0.7 | Not relevant enough, discarded |

---

## 7. Semantic QA Cache — Cost Optimization Layer

### 7.1 The Problem

The same types of questions are asked repeatedly:
- "Do you accept Medicare?"
- "What services do you offer?"
- "Do you serve [ZIP code]?"

Without caching, every question goes through full RAG retrieval + expensive thinking model (o3-mini). This is slow (~5-10 seconds) and expensive.

### 7.2 The Solution

The Semantic QA Cache stores question-answer pairs in ChromaDB. When a new question comes in, it checks if a similar question has been answered before using embedding similarity.

### 7.3 How It Works

```
New Question: "Does myOnsite accept Blue Cross insurance?"
         │
         ▼
┌─────────────────────────────────────┐
│ 1. Generate embedding for question  │
│    (all-MiniLM-L6-v2, 384d)        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. Search qa_cache collection       │
│    in ChromaDB                      │
│    Find most similar cached Q       │
└────────────┬────────────────────────┘
             │
    ┌────────┴─────────┐
    │ Similarity check │
    └──┬───────────┬───┘
       │           │
   ≥ 0.85      < 0.85
   (HIT)       (MISS)
       │           │
       ▼           ▼
┌──────────┐  ┌────────────────┐
│ Fast     │  │ Full RAG +     │
│ model    │  │ Thinking model │
│ (gpt-4o  │  │ (o3-mini)      │
│  -mini)  │  │                │
│ with     │  │ Then CACHE     │
│ cached   │  │ the Q&A pair   │
│ context  │  │ for next time  │
└──────────┘  └────────────────┘
```

### 7.4 Cache Thresholds

| Threshold | Value | Effect |
|-----------|-------|--------|
| `SIMILARITY_THRESHOLD` | 0.85 | Minimum similarity for a cache hit |
| `HIGH_CONFIDENCE_THRESHOLD` | 0.92 | Higher confidence — even less LLM reasoning needed |

### 7.5 Entity Bypass (Smart Cache Invalidation)

Even when similarity >= 0.85, the cache is bypassed if the new question contains entities not present in the cached answer:

- **Names** not in the cached answer
- **Locations** not covered (e.g., specific city not mentioned)
- **Dates/times** not in the cached Q&A
- **Personal details** unique to the new question

This prevents the cache from returning generic answers when the user asks about something specific.

### 7.6 What Gets Cached

When a Q&A pair is cached, the following is stored:

| Field | Content | Max Length |
|-------|---------|-----------|
| Question text | Original question | — |
| Question embedding | 384-dimensional vector | — |
| Answer summary | Extracted key facts | 1000 chars |
| Full answer | Complete LLM response | 2000 chars |
| Keywords | Extracted keywords | — |
| Intent | Detected intent category | — |
| Timestamp | When cached | — |

### 7.7 Cost Savings

| Path | Model Used | Approx. Cost/Query | Approx. Latency |
|------|-----------|-------------------|-----------------|
| Cache MISS | o3-mini (thinking) | ~$0.01-0.03 | 5-10 seconds |
| Cache HIT | gpt-4o-mini (fast) | ~$0.001-0.003 | 1-3 seconds |
| **Savings** | — | **~70% cost reduction** | **~50% faster** |

---

## 8. Token Management and Context Window Strategy

### 8.1 What Are Tokens?

Tokens are pieces of words that LLMs process. "Hello world" ≈ 2 tokens. "Mobile phlebotomy appointment scheduling" ≈ 5 tokens. Models have a maximum context window (input + output tokens).

### 8.2 Max Token Settings

| Parameter | Value | Used For |
|-----------|-------|----------|
| `OPENAI_MAX_TOKENS` | 300 (default) | Maximum response length for standard models |
| O3/O1 models | `max_completion_tokens: 1000` | Thinking models need more output tokens for reasoning |
| `TEMPERATURE` | 0.7 (config), 0.3 (docker-compose production) | Controls randomness; lower = more deterministic |

**Why 300 max tokens for responses?** The chatbot follows RULE #0 (BE BRIEF): 2-3 sentences for general questions. 300 tokens ≈ 225 words ≈ 10-15 sentences, which is more than enough. This keeps responses focused and costs low.

**Why 1000 for O3/O1?** These "thinking" models use tokens for internal reasoning chains before producing the visible answer. They need more output budget.

### 8.3 Token Counting

`tiktoken` (OpenAI's tokenizer) is in `requirements.txt` but is **not actively used** for counting. Instead, the project uses **character-based truncation** as a simpler proxy:

| Context | Character Limit | Approx. Token Equivalent |
|---------|----------------|-------------------------|
| RAG context total | 2000 chars | ~500 tokens |
| Per RAG document | 500 chars | ~125 tokens |
| OCR text | 1000 chars | ~250 tokens |
| Cached answer summary | 1000 chars | ~250 tokens |
| Cached full answer | 2000 chars | ~500 tokens |

**Why character-based instead of token-based?** Simpler, faster, and good enough. A character is roughly 0.25 tokens for English text. The system never approaches context window limits because:
1. Responses are capped at 300 tokens
2. RAG context is capped at 2000 characters
3. Conversation history is sliced (not the full history)
4. System prompt is ~2000 tokens (optimized version)

### 8.4 Conversation History Management

Different code paths keep different amounts of history:

| Code Path | History Kept | Reasoning |
|-----------|-------------|-----------|
| LangGraph (graph/nodes.py) | **All messages** | LangGraph's `MessagesState` keeps full history; checkpointer handles persistence |
| OpenAI service (function calling) | Last 5 exchanges (10 messages) | Enough context for tool decisions |
| OpenAI service (direct call) | Last 4 exchanges (8 messages) | Balances context vs cost |
| OpenAI service (session context) | Last 3 messages | Minimal context for prompt building |
| Intelligent AI service | Last 10 messages | More context for complex reasoning |
| Conversation summarization | Last 10 messages | Enough to generate a summary |
| Response post-processor | Last 6 messages | Context for response cleanup |

### 8.5 Context Window Budget (Approximate)

For a typical LangGraph request with gpt-4o-mini (128K context window):

| Component | Approximate Tokens |
|-----------|--------------------|
| System prompt (optimized) | ~2,000 |
| RAG context | ~500 |
| Conversation history (10 messages) | ~1,000-2,000 |
| Tool definitions | ~300 |
| **Total input** | **~3,800-4,800** |
| Max output | 300-1,000 |
| **Total** | **~4,100-5,800** |

This is well within the 128K context window. The system is nowhere near the limit for typical conversations.

### 8.6 Error Handling for Context Overflow

If OpenAI returns a `context_length_exceeded` error, the system catches it and returns a fallback response. This is a safety net that should rarely trigger.

---

## 9. Smart Model Routing — Fast vs Thinking Models

### 9.1 The Concept

Not all questions require the same level of AI reasoning. "What are your hours?" is simple. "Compare your phlebotomy services to going to a Quest Diagnostics location and explain the insurance implications" is complex.

Using the expensive thinking model for simple questions wastes money and adds latency. Using the cheap fast model for complex questions produces poor answers.

### 9.2 The Two Models

| Model | Role | Timeout | Cost | Best For |
|-------|------|---------|------|----------|
| **gpt-4o-mini** (FAST_MODEL) | Quick, simple responses | 25 seconds | ~$0.15/1M input tokens | FAQ, greetings, simple info, cache-hit follow-ups |
| **o3-mini** (THINKING_MODEL) | Deep reasoning | 45 seconds | ~$1.10/1M input tokens | Complex questions, multi-part queries, first-time answers |

### 9.3 Routing Decision Flow

```
Incoming Question
       │
       ▼
┌──────────────────────┐
│ 1. Check Semantic    │
│    QA Cache          │
└───────┬──────────────┘
        │
   ┌────┴────┐
   │ Cache   │
   │ HIT?    │
   └─┬─────┬─┘
    Yes    No
     │      │
     ▼      ▼
  FAST    ┌──────────────────────┐
  MODEL   │ 2. QueryComplexity   │
          │    Classifier        │
          └───────┬──────────────┘
                  │
           ┌──────┴──────┐
           │ Complexity? │
           └──┬──────┬───┘
         Simple   Complex
           │         │
           ▼         ▼
        FAST      THINKING
        MODEL     MODEL
```

### 9.4 QueryComplexityClassifier Details

The classifier uses regex patterns and heuristics (no ML model — fast and deterministic):

**Simple patterns (→ Fast Model):**
- Greetings: hi, hello, hey, good morning
- Thanks: thank you, thanks, appreciate
- Yes/No: yes, no, yeah, nope
- Basic company info: hours, location, address, phone
- Simple appointment: schedule, book, appointment
- Single ZIP check
- Basic insurance: do you accept [name]
- Simple FAQ: what services, how long, cost

**Complex indicators (→ Thinking Model):**
- Multiple conjunctions (and/or/but appearing multiple times)
- Multiple question marks
- Comparison words: compare, better, versus, difference, pros and cons
- Multi-location: multiple ZIP codes mentioned
- Conditional/hypothetical: if, what if, suppose, assuming
- Problem-solving: help me figure out, not sure, confused

**Heuristic fallbacks:**
- Word count ≤ 5 → Simple → Fast Model
- Word count > 20 → Moderate → Thinking Model
- Everything else → Moderate → Fast Model

### 9.5 Model-Specific API Parameters

| Parameter | GPT-3.5 / GPT-4 / GPT-4o-mini | O3-mini / O1 |
|-----------|-------------------------------|-------------|
| `max_tokens` | 300 | Not used |
| `max_completion_tokens` | Not used | 1000 |
| `temperature` | 0.3-0.7 | Not supported (omitted) |
| Response field | `content` | `content` + optional `reasoning_content` |

### 9.6 Configuration

| Environment Variable | Default | Purpose |
|---------------------|---------|---------|
| `FAST_MODEL` | gpt-4-turbo-preview | Model for simple queries |
| `THINKING_MODEL` | o3-mini-2025-01-31 | Model for complex queries |
| `ENABLE_SMART_ROUTING` | true | Toggle smart routing on/off |
| `OPENAI_MODEL` | gpt-4-1106-preview | Fallback model when smart routing is off |

---

## 10. Prompt Engineering System

### 10.1 Three-Tier Prompt Architecture

| Tier | File | Size | When Used |
|------|------|------|-----------|
| **Master** | `master_prompts.py` | ~16,000 tokens | Full prompt with extensive examples; used via `get_master_prompt()` |
| **Optimized** | `optimized_prompts.py` | ~2,000 tokens | Default in LangGraph; same rules but concise; `OPTIMIZED_SYSTEM_PROMPT` |
| **Compact** | `compact_prompts.py` | ~500 tokens | Fallback when context is tight; minimal but covers core rules |

The system uses `OPTIMIZED_SYSTEM_PROMPT` from `master_prompts.py` as the primary prompt in the LangGraph pipeline. The full master prompt is available for the legacy chat path.

### 10.2 Core Prompt Rules

**RULE #0: BE BRIEF BUT COMPLETE**
- General questions: 2-3 sentences
- Company info: 4-6 sentences with bullet points listing all services
- Confirmations: 1-2 sentences
- Never verbose, always end with a call-to-action

**RULE #0A: PERSONALIZE**
- Use the user's name once they provide it
- Reference their location directly (don't ask again if known)
- Acknowledge returning users

**RULE #0B: ALWAYS OFFER TO SCHEDULE**
- After answering about insurance → "Would you like to schedule an appointment?"
- After answering about services → "Would you like to schedule?"
- After confirming service area → "Would you like to schedule?"

### 10.3 Bot Identity Rules

- Always identify as **"Carevio"** by **myOnsite Healthcare**
- NEVER mention OpenAI, ChatGPT, GPT, or any AI provider
- NEVER say "as an AI" or "I'm an AI language model"
- If asked who built the bot: "I'm Carevio, built by myOnsite Healthcare"

### 10.4 Safety Rules

- Direct medical emergencies to **911** immediately
- Never provide medical advice, diagnosis, or treatment recommendations
- Scope is limited to: scheduling, services, insurance, order tracking, company info
- Politely decline off-topic questions

### 10.5 Appointment Flow (8 Fields)

The prompt defines a specific order for collecting appointment information:

1. **ZIP Code** — Check service area first (uses `check_zip_serviceability` tool)
2. **Preferred Date** — Must be future date, validate format
3. **Preferred Time** — Between 8:00 AM and 7:00 PM
4. **Service Type** — Mobile phlebotomy, INR, clinical trial, etc.
5. **Full Name** — Patient's name
6. **Email** — For confirmation
7. **Phone** — For callback
8. **Insurance** — Medicare, UHC, Aetna, etc. (uses `lookup_insurance` tool)

**Critical rules:**
- Never say "confirmed" or "scheduled" — always say "our team will call you to confirm"
- Show an 8-field summary when all fields are collected
- Validate: ZIP must be 5 digits, date must be in the future, time must be within business hours

### 10.6 Insurance Handling

The prompt includes specific insurance logic:
- "Serve" = "accept" = "take" (same meaning)
- Accepted: Medicare, UHC/Optum, Aetna, BCBS, Humana, Cigna, Tricare
- Plan types: HMO, PPO, POS
- If unsure: "Let me check — can you tell me the full plan name?"

### 10.7 Context Injection

The system prompt is augmented at runtime with:

```
Session Context:
- User name: [if known]
- User location: [if known]
- Conversation state: [initial/scheduling/general]

Collected Data:
- zip_code: 34236
- preferred_date: March 15, 2026
- [... other collected fields ...]

RAG Context:
[Retrieved knowledge documents]
```

---

## 11. Chat Widget — Customer-Facing Frontend

### 11.1 Technology

Pure **vanilla JavaScript + HTML + CSS** — no framework, no build step, no dependencies.

### 11.2 How It's Embedded

Website owners add a single `<script>` tag:
```html
<script src="https://moschat.myonsitehealthcare.com/static/chat-widget.js"></script>
```

The widget creates its own DOM elements, styles, and event handlers. It does not interfere with the host site's CSS or JavaScript.

### 11.3 Configuration

`chat-widget-config.js` is **auto-generated from `.env`** at server startup by `src/utils/config_generator.py`. It contains:

| Setting | Source |
|---------|--------|
| `API_BASE_URL` | `BACKEND_URL` env var |
| API endpoints | Hardcoded paths (/api/clean/message, /api/upload/files, etc.) |
| Logo URL | `${API_BASE_URL}/static/medinovai-logo.png` |

### 11.4 Features

| Feature | Implementation |
|---------|---------------|
| **Health check** | Polls `GET /api/health` to show Online/Offline/Connecting status |
| **Send messages** | POST to `/api/clean/message` or `/api/v2/message` |
| **Real-time updates** | WebSocket connection to `/ws/{clientId}` |
| **File upload** | POST to `/api/upload/files` with multipart form data |
| **Feedback** | POST to `/api/feedback/submit` (thumbs up/down on responses) |
| **Conversation history** | GET from `/api/clean/history/{session_id}` |
| **Timeout handling** | `fetchWithTimeout()` wrapper for all API calls |
| **Error display** | `showBackendError()` for connection issues |

### 11.5 Session Management

- Session ID is generated client-side (format: `temp_XXXX_DDMMYYYY_HHMMSS`)
- Stored in browser `localStorage` for session continuity
- Passed with every API request

---

## 12. Dashboard — Admin Panel

### 12.1 Technology Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 |
| Language | TypeScript |
| Build Tool | Vite 5 |
| Styling | Tailwind CSS |
| Charts | Recharts |
| HTTP Client | Axios |
| Real-time | Socket.IO Client |
| Auth | Keycloak JS |
| Routing | React Router DOM |
| Notifications | react-hot-toast |
| Date handling | date-fns-tz |

### 12.2 Authentication Flow

1. User navigates to dashboard
2. `ProtectedRoute` component checks Keycloak session
3. If not authenticated → redirect to Keycloak login page
4. Keycloak handles username/password (or SSO)
5. On success → Keycloak issues JWT token
6. Dashboard stores token, includes in all API requests via `Authorization: Bearer <token>`
7. Backend validates token against Keycloak JWKS endpoint

**Keycloak configuration:**
- URL: `https://auth.myonsitehealthcare.com`
- Realm: `medinov-ai-staging`
- Client: `dashboard-client`

### 12.3 Role-Based Access

| Role | Access |
|------|--------|
| **admin** | Everything — user management, settings, analytics, conversations, team |
| **manager** | Analytics, team management, conversations, settings |
| **user** (agent) | Own conversations, own dashboard, limited settings |

### 12.4 Pages and Routes

| Route | Component | Access | Purpose |
|-------|-----------|--------|---------|
| `/` | Role-based redirect | All | Shows `Dashboard` for admin/manager, `UserDashboard` for agents |
| `/my-dashboard` | `UserDashboard` | All | Personal stats, queue, assigned conversations |
| `/my-conversations` | `MyConversations` | All | Agent's own active conversations |
| `/conversations` | `ConversationsList` | All | All conversations with search and filters |
| `/conversations/:sessionId` | `ConversationDetail` | All | Single conversation with live chat interface |
| `/analytics` | `Analytics` | Manager+ | Chat volume, response times, intent analysis, bot performance |
| `/team` | `TeamManagement` | Manager+ | Team member list, status, workload |
| `/settings` | `Settings` | All | Canned responses, FAQ, preferences |
| `/users` | `UserManagement` | Admin | Create/edit/deactivate users, assign roles |

### 12.5 Real-Time Features (Socket.IO Events)

| Event | Direction | Purpose |
|-------|-----------|---------|
| `new_message` | Server → Client | New message in any conversation |
| `agent_needed` | Server → Client | Escalation request — shows urgent alert banner |
| `business_inquiry_alert` | Server → Client | Business inquiry notification |
| `user_status_changed` | Bidirectional | Agent online/offline/busy status |
| `join_session` | Client → Server | Agent joins a conversation room |
| `leave_session` | Client → Server | Agent leaves a conversation room |
| `typing_start` / `typing_stop` | Bidirectional | Typing indicators |
| `user_disconnect_notification` | Server → Client | Patient disconnected |

### 12.6 API Layer

The dashboard has 13+ API modules in `dashboard/src/api/`:

| Module | Endpoints Covered |
|--------|-------------------|
| `adminApi.ts` | Admin operations, database cleanup |
| `analyticsApi.ts` | Dashboard analytics, charts, trends |
| `authApi.ts` | Login, logout, session refresh, registration |
| `axiosConfig.ts` | Axios instance with base URL, interceptors, auth headers |
| `conversationsApi.ts` | List, search, create, assign, update conversations |
| `conversationSummaryApi.ts` | AI-generated conversation summaries |
| `escalationApi.ts` | Request, claim, release, end escalations |
| `exportApi.ts` | CSV/PDF export of conversations and analytics |
| `feedbackApi.ts` | Message feedback (thumbs up/down) |
| `notificationsApi.ts` | Notification list, mark read, pin, mute |
| `searchApi.ts` | Global search across conversations, messages, patients |
| `sentimentApi.ts` | Sentiment analytics and trends |
| `usersApi.ts` | User CRUD, status management, online list |

### 12.7 Deployment

- Built with Vite into static files
- Served by **Nginx** on port 3006
- Nginx proxies `/api/` and `/socket.io/` to the FastAPI backend (port 8007)
- SPA routing: `try_files $uri $uri/ /index.html`

---

## 13. Human Agent Escalation Flow

### 13.1 Trigger

Escalation is triggered when:
- User explicitly asks for a human (e.g., "talk to a person", "I want a real agent")
- The `router_node` in LangGraph detects `intent: "support"`

### 13.2 Detailed Flow

```
Step 1: Detection
────────────────
  User: "I want to talk to a real person"
  router_node detects intent = "support"
  Routes to handoff_node

Step 2: Escalation Request
──────────────────────────
  AgentEscalationService.request_escalation():
  ├── Create record in MongoDB collection: agent_escalations
  │   { session_id, status: "pending", created_at, conversation_summary }
  ├── Set Redis key: session:{session_id}:status = "human_handoff_requested"
  ├── Broadcast Socket.IO event: "agent_needed"
  │   { session_id, summary, priority, timestamp }
  ├── Create Mattermost channel: "chat-{session_id}"
  │   └── Add default members (from BYDEFAULT_MEMBERS env var)
  └── Send notification via NotificationService

Step 3: Dashboard Alert
───────────────────────
  Dashboard agents see:
  ├── UrgentAlertBanner at top of page
  ├── Toast notification
  └── Updated conversation list with "Needs Agent" badge

Step 4: Agent Claims Conversation
─────────────────────────────────
  Agent clicks "Claim" button:
  ├── POST /api/escalation/{session_id}/claim
  ├── Redis SETNX (atomic lock) prevents double-claiming
  ├── Set Redis key: ai_paused:{session_id} = true
  ├── Update MongoDB escalation: status = "claimed", agent_id
  └── Broadcast: "agent_claimed" event to other agents

Step 5: Human Chat
──────────────────
  ├── AI is PAUSED — paused_node returns "An agent is helping you"
  ├── Agent chats via Dashboard or Mattermost
  ├── Messages forwarded bidirectionally:
  │   Widget → Backend → Mattermost channel
  │   Mattermost → Backend → Widget (via WebSocket)
  └── DashboardSyncService keeps both sides in sync

Step 6: Resolution
──────────────────
  Agent clicks "Resume AI" or "End Chat":
  ├── POST /api/escalation/resume-ai or /end-chat
  ├── Delete Redis key: ai_paused:{session_id}
  ├── Update MongoDB escalation: status = "resolved"
  └── AI resumes handling the conversation
```

### 13.3 Atomic Claim Lock

To prevent two agents from claiming the same conversation simultaneously, Redis `SETNX` (Set if Not eXists) is used. This is an atomic operation — only the first agent to execute it succeeds. Others get a "already claimed" response.

---

## 14. Mattermost Integration

### 14.1 Purpose

Mattermost provides a familiar Slack-like interface for human agents to chat with patients during escalation, without needing to use the dashboard.

### 14.2 Configuration

| Environment Variable | Purpose |
|---------------------|---------|
| `MATTERMOST_URL` | Mattermost server URL |
| `MATTERMOST_WS_URL` | WebSocket URL for real-time events |
| `MATTERMOST_TOKEN` | Bot/admin token for API access |
| `MATTERMOST_CHANNEL_ID` | Default notification channel |
| `MATTERMOST_DEFAULT_TEAM_ID` | Team for creating channels |
| `BYDEFAULT_MEMBERS` | Users auto-added to every handoff channel |
| `NOTIFY_MEMBERS` | Users notified on escalation |
| `MANDATORY_MEMBER` | User always added to channels |
| `HANDOFF_TIMEOUT_MINUTES` | Auto-timeout for unclaimed handoffs (default: 2) |
| `SUMMARY_MAX_MESSAGES` | Messages included in handoff summary (default: 10) |

### 14.3 Services

| Service | Purpose |
|---------|---------|
| `MattermostService` | REST API client — create channels, send messages, add members, manage channel-session mapping in Redis |
| `MattermostWebSocket` | WebSocket client — listens for agent messages in real-time and forwards to patient's widget |
| `MattermostEventHandler` | Processes Mattermost events (message posted, channel joined, etc.) |

### 14.4 Channel-Session Mapping

When escalation creates a Mattermost channel, the mapping is stored in Redis:
- Key: `mattermost:session:{session_id}` → Value: `channel_id`
- Key: `mattermost:channel:{channel_id}` → Value: `session_id`

This bidirectional mapping enables message routing: when an agent posts in Mattermost, the system looks up which patient session to forward the message to.

---

## 15. 3CX PBX Presence Integration

### 15.1 Purpose

Before escalating to a human agent, the system checks if any agents are actually available (not on phone calls, not away).

### 15.2 How It Works

1. `ThreeCXPresenceService` calls the 3CX REST API to get extension status
2. Returns agent availability: available, busy, on-call, away, DND
3. `OptimizedHybridPresenceManager` combines 3CX presence with Mattermost online status
4. `ConversationQueueService` uses presence data for round-robin agent assignment

### 15.3 Fallback

If 3CX API is unavailable, the system falls back to Mattermost online status as a presence indicator.

### 15.4 Configuration

| Variable | Purpose |
|----------|---------|
| `THREE_CX_ENABLE` | Toggle 3CX integration on/off |
| `THREE_CX_SERVER_URL` | 3CX server URL |
| `THREE_CX_API_KEY` | API key for authentication |
| `USERNAME_MATCHING_STRATEGY` | How to match 3CX extensions to agents (multi-strategy) |
| `MATCHING_CONFIDENCE_THRESHOLD` | Minimum confidence for username matching (0.4) |
| `FALLBACK_TO_MATTERMOST` | Use Mattermost status when 3CX is unavailable |

---

## 16. Redis — Caching, Sessions, and Real-Time

### 16.1 Connection

- Library: `redis.asyncio` (async Redis client)
- URL: `REDIS_URL` from environment (default: `redis://:redis_secure_pass_2024@localhost:6379`)
- Docker port: 6383 (external) → 6379 (internal)
- Password protected
- Init with 3 retries and exponential backoff
- Fallback: In-memory dict (10K items max, 1-hour TTL) if Redis is unavailable

### 16.2 Key Patterns and Usage

| Key Pattern | Value | TTL | Purpose |
|-------------|-------|-----|---------|
| `user_data:{session_id}` | JSON blob | 24 hours | Full user session data (name, email, phone, state, etc.) |
| `session:{session_id}:user_info` | JSON | — | Structured user info |
| `session:{session_id}:user:{field}` | String | — | Individual user fields (name, email, phone, zip, etc.) |
| `session:{session_id}:status` | String | — | Conversation status: active, human_handoff_requested, human_handoff_active |
| `session:{session_id}:status_changed_at` | Timestamp | — | When status last changed |
| `session:{session_id}:status_history` | List (max 100) | — | Status change history |
| `ai_paused:{session_id}` | Boolean | — | Flag: AI paused for human agent intervention |
| `mattermost:session:{session_id}` | Channel ID | — | Mattermost channel mapping (session → channel) |
| `mattermost:channel:{channel_id}` | Session ID | — | Mattermost channel mapping (channel → session) |
| Rate limit keys | Counter | Window-based | Per-IP request counting |
| Cache keys | Various | TTL-based | Generic caching via `set_cache()` / `get_cache()` |

### 16.3 Socket.IO Redis Adapter

Socket.IO uses `AsyncRedisManager` as its adapter. This enables:
- Broadcasting events across multiple server workers (if scaled to multiple workers in the future)
- Pub/sub for real-time event distribution
- Currently runs with 1 worker, but the adapter is in place for future scaling

### 16.4 Rate Limiting

`EnhancedRedisService.check_rate_limit(identifier, limit, window)` implements a sliding window rate limiter:
- Increments a counter per IP
- Counter has a TTL equal to the window size
- Returns True/False for whether the limit is exceeded
- Used by `RateLimitMiddleware`

---

## 17. MongoDB — Primary Database

### 17.1 Connection

- Libraries: `pymongo` (sync) + `motor` (async)
- URI: `MONGO_URI` from environment
- Database name: `MONGODB_DB_NAME` (default: `medinovai_chatbot`)
- External to Docker Compose (hosted separately)
- Exponential backoff on connection failure

### 17.2 Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `sessions` | Chat session metadata | session_id, created_at, updated_at, status |
| `conversations` | Full conversation history | session_id, messages[], created_at |
| `chat_sessions_extended` | Dashboard-synced sessions | Extended session data with agent info |
| `appointments` | Appointment records | patient_name, date, time, service, ZIP, insurance, status |
| `patients` | Patient profiles | phone, email, name, address, insurance, history |
| `agent_escalations` | Escalation requests | session_id, status (pending/claimed/resolved), agent_id |
| `message_feedback` | Feedback on AI responses | session_id, message_id, feedback (up/down), timestamp |
| `uploaded_documents` | File upload metadata | file_id, session_id, filename, type, size |
| `dashboard_users` | Dashboard user accounts | username, email, role, status, permissions |
| `notifications` | Agent notifications | user_id, type, content, read, pinned |
| LangGraph `checkpoints` | Conversation state | thread_id (session_id), checkpoint data, metadata |

### 17.3 Indexes

Created by `scripts/create_text_indexes.py`:
- Text indexes on conversation content for full-text search
- Compound indexes on session_id + timestamp for efficient queries
- TTL indexes for automatic cleanup of old data

---

## 18. Authentication and Security

### 18.1 Chat Widget (Patient-Facing)

- **No authentication** — public access, any visitor can chat
- Rate limiting prevents abuse (200/day, 50/hour per IP)
- Input sanitization middleware cleans all incoming data
- Session ID is the only identifier

### 18.2 Dashboard (Agent-Facing)

- **Keycloak SSO** — full authentication required
- JWT tokens validated against Keycloak JWKS endpoint
- Session data stored in Redis with TTL
- Auto-provisioning: first Keycloak login creates dashboard user

### 18.3 Middleware Security Stack

| Middleware | What It Does |
|-----------|-------------|
| **CORS** | Restricts origins to configured list (`ADDITIONAL_CORS_ORIGINS`) |
| **RateLimitMiddleware** | Redis-backed per-IP rate limiting (200/day, 50/hour default) |
| **SecurityHeadersMiddleware** | X-Frame-Options, Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options |
| **InputSanitizationMiddleware** | XSS prevention, SQL injection prevention on all request data |
| **NoCacheStaticMiddleware** | Forces browsers to fetch fresh static files (no stale widget code) |

### 18.4 RBAC (Role-Based Access Control)

Defined in `src/middleware/rbac_decorator.py`:

| Permission | Admin | Manager | Agent |
|-----------|-------|---------|-------|
| view_conversations | Yes | Yes | Yes |
| manage_conversations | Yes | Yes | Limited |
| manage_agents | Yes | Yes | No |
| access_analytics | Yes | Yes | No |
| manage_users | Yes | No | No |
| manage_settings | Yes | Yes | No |
| system_administration | Yes | No | No |

Decorators: `@require_role("admin")`, `@require_permission("manage_users")`, `@require_any_permission(["access_analytics", "manage_agents"])`

---

## 19. All Services — Complete Catalog

The backend has **69 service modules** in `src/services/`:

### AI and LLM Services

| Service | Purpose |
|---------|---------|
| `openai_service.py` | OpenAI API client; model selection; smart routing; QueryComplexityClassifier integration |
| `intelligent_ai_service.py` | AI orchestration — OpenAI-only response generation with context |
| `advanced_intelligence.py` | Urgency detection, emotion analysis, context understanding, follow-up generation |
| `query_complexity_classifier.py` | Regex + heuristic classification of query complexity (simple/moderate/complex) |

### RAG and Knowledge Services

| Service | Purpose |
|---------|---------|
| `rag_service.py` | RAG retrieval — ChromaDB/FAISS search, context formatting, document chunking |
| `semantic_qa_cache.py` | Semantic Q&A cache — ChromaDB-backed similarity caching for repeated questions |
| `embedding_service.py` | Document embedding — chunking, PDF/DOCX text extraction |
| `semantic_intent_service.py` | Semantic intent detection with Redis caching |
| `semantic_matching_service.py` | Insurance matching, user type detection, date/sentiment matching |

### Conversation Management

| Service | Purpose |
|---------|---------|
| `state_management_service.py` | Conversation state machine (initial → scheduling → general → handoff) |
| `conversation_agent.py` | General conversation handler; off-topic filtering |
| `conversation_summarization_service.py` | AI-generated conversation summaries via OpenAI |
| `conversation_title_service.py` | Dynamic conversation titles (from phone, email, or name) |
| `conversation_timeout_service.py` | 5-minute inactivity auto-completion |
| `conversation_queue_service.py` | Round-robin agent assignment based on 3CX presence |
| `conversation_tagging_service.py` | Add/remove conversation tags |
| `conversation_notes_service.py` | Internal notes and pinning on conversations |
| `conversation_assignment_service.py` | Assign, transfer, auto-assign conversations |
| `conversation_deletion_service.py` | Single/bulk conversation deletion with cleanup |
| `behavioral_monitoring_service.py` | Detect repeated questions, abandonment patterns |

### Agent and Escalation

| Service | Purpose |
|---------|---------|
| `agent_escalation_service.py` | Escalation request, claiming (Redis SETNX), release, notifications |
| `agent_status_service.py` | Agent online/offline/busy/away/DND status management |
| `production_handoff_manager.py` | Detect, initiate, and end human handoff |
| `ai_pause_manager.py` | 5-minute AI pause when agent intervenes |
| `online_status_service.py` | Redis-backed online/offline tracking for dashboard users |

### Mattermost

| Service | Purpose |
|---------|---------|
| `mattermost_service.py` | REST API client — channels, messages, members, session mapping |
| `mattermost_websocket.py` | WebSocket client — real-time message forwarding, handoff timeout |
| `mattermost_events.py` | Event handler for Mattermost webhooks |

### 3CX and Presence

| Service | Purpose |
|---------|---------|
| `three_cx_presence_service.py` | 3CX REST API for agent presence (available/busy/on-call) |
| `optimized_hybrid_presence_manager.py` | Combines 3CX + Mattermost presence for agent availability |
| `smart_presence_cache.py` | TTL-based cache for presence data |
| `presence_mapping_analytics.py` | Analytics on channel/member presence |

### Database Services

| Service | Purpose |
|---------|---------|
| `mongo_service.py` | Core MongoDB operations — sessions, conversations, appointments |
| `enhanced_mongo_service.py` | Extended MongoDB — sync/async, advanced queries |
| `dashboard_mongo_service.py` | Dashboard-specific MongoDB — collections, indexes, dashboard data |
| `mongo_connection_pool.py` | Shared MongoDB connection pool |
| `enhanced_redis_service.py` | Async Redis operations — user data, sessions, cache, rate limiting |
| `response_cache_service.py` | Redis cache for frequent query responses |

### Dashboard Services

| Service | Purpose |
|---------|---------|
| `dashboard_auth_service.py` | Password hashing (bcrypt), session management, Keycloak integration |
| `dashboard_sync_service.py` | Real-time chatbot → dashboard conversation sync |
| `dashboard_websocket_service.py` | Socket.IO event handling, rooms, agent actions |
| `dashboard_conversation_service.py` | Dashboard conversation CRUD, messages, participants |

### Data Extraction and Processing

| Service | Purpose |
|---------|---------|
| `user_data_service.py` | Extract email, phone, name from user messages |
| `entity_extraction_service.py` | Named entity extraction (name, email, phone, ZIP) |
| `datetime_parser.py` | Natural language date/time parsing |
| `prescription_parser.py` | Regex extraction from prescription documents |
| `response_post_processor.py` | Clean unwanted follow-ups, format emergency responses |
| `response_enhancer.py` | Formatting improvements, company context injection |
| `intent_detection_service.py` | Intent classification (patient/job_candidate/inquiry) |
| `sentiment_analysis_service.py` | TextBlob + keyword-based sentiment analysis |

### External Integrations

| Service | Purpose |
|---------|---------|
| `service_area.py` | ZIP code validation via CommonGateway API |
| `keycloak_service.py` | JWT validation, JWKS cache, user auto-provisioning |
| `email_service.py` | SMTP email sending (AWS SES) |
| `email_templates.py` | HTML email templates for appointments and escalations |
| `llamacloud_service.py` | LlamaCloud API for PDF/image document parsing |
| `user_identity_verification.py` | OTP verification via Twilio |
| `export_service.py` | CSV/PDF export of conversations and analytics |

### Other

| Service | Purpose |
|---------|---------|
| `patient_data_service.py` | Patient lookup by phone, Redis cache |
| `patient_data_service_v2.py` | Multi-patient support per phone number |
| `patient_integration.py` | Patient data + prescription + contacts integration |
| `contact_manager.py` | Primary/secondary contact validation |
| `appointment_flow_handler.py` | Rule-based appointment scheduling states |
| `appointment_checklist_service.py` | City→ZIP mapping, checklist validation, insurance |
| `notification_service.py` | System notifications and compact prompts |
| `analytics_service.py` | Agent metrics, analytics trends, performance |
| `response_time_calculator.py` | Bot and agent response time tracking |
| `session_id_generator.py` | Display ID format: `temp_XXXX_DDMMYYYY_HHMMSS` |
| `quick_replies_service.py` | LangGraph state schema (ChatState) |
| `company_agent.py` | Company knowledge via web scraping |

---

## 20. All API Routes — Complete Catalog

### Chat Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/message` | Legacy chat endpoint (CleanChatService) |
| GET | `/api/chat/health` | Chat service health check |
| POST | `/api/clean/message` | Clean chat endpoint (production) |
| GET | `/api/clean/history/{session_id}` | Get conversation history |
| POST | `/api/clean/production/session/initialize` | Initialize production session |
| GET | `/api/clean/production/health` | Production health check |
| GET | `/api/clean/semantic-cache/stats` | Semantic cache statistics |
| POST | `/api/clean/semantic-cache/invalidate` | Invalidate cache entries |
| POST | `/api/v2/message` | LangGraph chat endpoint (v2) |
| POST | `/api/v2/stream` | Streaming LangGraph response |
| GET | `/api/v2/history` | V2 conversation history |
| GET | `/api/v2/health` | V2 health check |

### Appointment Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/appointments` | Create appointment |
| GET | `/api/appointments/{id}` | Get appointment by ID |
| GET | `/api/appointments` | List appointments |
| PATCH | `/api/appointments/{id}/status` | Update appointment status |
| DELETE | `/api/appointments/{id}` | Delete appointment |
| POST | `/api/appointments/reschedule` | Reschedule appointment |
| GET | `/api/appointments/lookup/{id}` | Lookup appointment |
| POST | `/api/validate-zip` | Validate ZIP code |

### Escalation Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/escalation/request` | Request human agent |
| POST | `/api/escalation/{session_id}/claim` | Agent claims conversation |
| POST | `/api/escalation/{session_id}/release` | Agent releases conversation |
| POST | `/api/escalation/end-chat` | End human chat session |
| POST | `/api/escalation/resume-ai` | Resume AI after human intervention |
| GET | `/api/escalation/{session_id}/status` | Get escalation status |
| GET | `/api/escalation/pending/list` | List pending escalations |

### Dashboard Auth Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/dashboard/auth/login` | Username/password login |
| POST | `/api/dashboard/auth/keycloak-login` | Keycloak SSO login |
| GET | `/api/dashboard/auth/keycloak-config` | Get Keycloak configuration |
| POST | `/api/dashboard/auth/logout` | Logout |
| GET | `/api/dashboard/auth/me` | Get current user |
| POST | `/api/dashboard/auth/register` | Register new dashboard user |
| POST | `/api/dashboard/auth/change-password` | Change password |
| POST | `/api/dashboard/auth/refresh-session` | Refresh session token |
| GET | `/api/dashboard/auth/validate` | Validate session |

### Dashboard Conversation Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/conversations` | List all conversations |
| GET | `/api/dashboard/conversations/{id}` | Get single conversation |
| POST | `/api/dashboard/conversations/{id}/assign` | Assign to agent |
| POST | `/api/dashboard/conversations/{id}/notes` | Add internal note |
| POST | `/api/dashboard/conversations/{id}/tags` | Add/remove tags |
| PUT | `/api/dashboard/conversations/{id}/status` | Update status |
| POST | `/api/dashboard/conversations/{id}/pin` | Pin conversation |
| GET | `/api/dashboard/conversations/{id}/summary` | AI summary |
| POST | `/api/dashboard/conversations/{id}/send` | Send agent message |
| DELETE | `/api/dashboard/conversations/{id}` | Delete conversation |

### Dashboard Analytics Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/analytics/overview` | Overview stats |
| GET | `/api/dashboard/analytics/chat-volume` | Chat volume trends |
| GET | `/api/dashboard/analytics/response-times` | Response time metrics |
| GET | `/api/dashboard/analytics/intents` | Intent distribution |
| GET | `/api/dashboard/analytics/bot-performance` | AI performance metrics |

### Other Routes

| Category | Key Endpoints |
|----------|--------------|
| **Upload** | POST `/api/upload/files`, GET `/api/upload/files/{client_id}`, DELETE `/api/upload/files/{file_id}` |
| **Patient Data** | POST `/api/patients/lookup`, GET `/api/patients/{phone}`, POST `/api/patients`, PUT `/api/patients/{phone}` |
| **Orders** | POST `/api/orders/validate-requisition`, POST `/api/orders/get-latest-order` |
| **Email** | POST `/api/email/send`, POST `/api/email/test`, GET `/api/email/status` |
| **Feedback** | POST `/api/feedback/submit` |
| **Notifications** | GET `/api/notifications`, PUT `/api/notifications/{id}/read`, POST `/api/notifications/{id}/pin` |
| **Export** | POST `/api/dashboard/export/conversations/csv`, GET `/api/dashboard/export/analytics/csv` |
| **Search** | GET `/api/dashboard/search/conversations`, GET `/api/dashboard/search/messages`, GET `/api/dashboard/search/all` |
| **Sentiment** | GET `/api/sentiment/overview`, GET `/api/sentiment/trends`, GET `/api/sentiment/distribution` |
| **Health** | GET `/api/health`, GET `/api/health/detailed` |
| **Monitoring** | GET `/api/monitoring/mongodb`, GET `/api/monitoring/collections`, GET `/api/monitoring/health` |
| **Vector** | POST `/api/vector/search`, POST `/api/vector/rag`, POST `/api/vector/documents` |
| **Mattermost** | POST `/api/mattermost/handoff/initiate`, GET `/api/mattermost/handoff/status/{id}`, POST `/api/mattermost/handoff/end/{id}` |
| **Webhooks** | POST `/api/webhooks/twilio/sms`, POST `/api/webhooks/twilio/voice` |
| **Prescription** | POST `/api/prescription/parse`, POST `/api/prescription/validate`, POST `/api/prescription/extract-from-ai` |

---

## 21. Middleware Stack

| Order | Middleware | Purpose |
|-------|-----------|---------|
| 1 | **CORS** | Cross-Origin Resource Sharing — allows widget and dashboard domains |
| 2 | **SecurityHeadersMiddleware** | X-Frame-Options: DENY, CSP, HSTS, X-Content-Type-Options: nosniff |
| 3 | **RateLimitMiddleware** | Redis-backed per-IP rate limiting (configurable limits) |
| 4 | **InputSanitizationMiddleware** | XSS prevention, script tag removal, SQL injection prevention |
| 5 | **NoCacheStaticMiddleware** | Cache-Control: no-cache for static files to prevent stale widget code |
| 6 | **DashboardAuthMiddleware** | Validates Keycloak sessions for dashboard routes (cookie or Bearer token) |
| 7 | **RBAC Decorators** | Per-endpoint role/permission checks via decorators |

Note: `StorageMiddleware` (MongoDB conversation storage) exists but is **disabled** because it caused issues with the appointment flow state machine.

---

## 22. Data Models

### 22.1 Session Models (`src/models/session_models.py`)

```
ChatStates (enum):
  - initial
  - service_availability
  - appointment_scheduling
  - general_conversation
  - human_handoff

SessionModel:
  - session_id: str
  - user_data: dict
  - created_at: datetime
  - state: ChatStates

ConversationModel:
  - session_id: str
  - message: str
  - sender: str
  - response: str
  - timestamp: datetime

UserModel:
  - email: str
  - user_type: str (patient / phlebotomist)
  - name: str
  - created_at: datetime
```

### 22.2 Dashboard User Models (`src/models/dashboard_user_models.py`)

```
UserRole (enum): admin, manager, user
UserStatus (enum): active, inactive, suspended
OnlineStatus (enum): online, offline, away, busy, dnd

UserPermissions:
  - view_conversations, manage_conversations
  - manage_agents, access_analytics
  - manage_users, manage_settings
  - system_administration, export_data
  - view_reports

DashboardUser:
  - id, username, email, display_name
  - role: UserRole
  - status: UserStatus
  - online_status: OnlineStatus
  - permissions: UserPermissions
  - profile: UserProfile
  - keycloak_id: Optional[str]

ROLE_DEFAULT_PERMISSIONS:
  admin: all permissions = True
  manager: all except manage_users and system_administration
  user (agent): view_conversations, manage_conversations only
```

---

## 23. Utility Modules

| Module | Purpose |
|--------|---------|
| `config_generator.py` | Generates `chat-widget-config.js` from `.env` variables at startup |
| `emoji_cleaner.py` | Strips emojis from AI responses (AI sometimes adds unwanted emojis) |
| `date_parser.py` | Parses relative dates: "tomorrow", "next Monday", "in 2 days" |
| `date_validator.py` | Validates appointment dates are in the future and within business hours |
| `enhanced_validators.py` | Pydantic validators for phone (10 digits), email, ZIP (5 digits), user contacts |
| `websocket_helper.py` | Thread-safe WebSocket emit via the main asyncio event loop |
| `conversation_logger.py` | Structured logging for conversations with AI agent metadata |
| `logging_config.py` | Application-wide logging setup with `get_logger()` |
| `clean_logging_config.py` | Production logging — suppresses SSL noise, 3CX debug spam |
| `enhanced_monitoring.py` | `HealthCheckManager` and `SystemMetrics` for system health monitoring |
| `mongodb_migration.py` | Migration script for moving to new 3-collection database structure |

---

## 24. Deployment Architecture

### 24.1 Docker Services

| Service | Image | Port | Resources | Purpose |
|---------|-------|------|-----------|---------|
| **medinovai-chatbot** | Custom (Python 3.11) | 8007 | CPU + memory limits | FastAPI backend + Socket.IO |
| **dashboard** | Custom (Node 18 → Nginx) | 3006 | CPU + memory limits | React admin panel |
| **redis** | redis:7-alpine | 6383 → 6379 | — | Cache, sessions, pub/sub |
| **chroma** | chromadb/chroma:latest | 8003 → 8000 | — | Vector database |

**MongoDB** is external (not in Docker Compose).

### 24.2 Multi-Stage Dockerfile

```dockerfile
# Stage 1: Build Dashboard
FROM node:18-alpine AS dashboard-builder
  COPY dashboard/ .
  RUN npm ci && npm run build
  # Output: /dashboard/dist

# Stage 2: Build Backend + Bundle Dashboard
FROM python:3.11-slim
  # Install PyTorch (CPU only), sentence-transformers
  RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
  RUN pip install sentence-transformers

  # Install Python dependencies
  COPY requirements.txt .
  RUN pip install -r requirements.txt

  # Copy backend code
  COPY src/ ./src/
  COPY scripts/ ./scripts/

  # Copy built dashboard
  COPY --from=dashboard-builder /dashboard/dist ./dashboard/dist

  # Non-root user
  USER appuser
  EXPOSE 8007
  CMD ["uvicorn", "main:socket_app", "--host", "0.0.0.0", "--port", "8007"]
```

### 24.3 Startup Sequence

When `medinovai-chatbot` container starts:

1. Wait for Redis (health check: PING)
2. Wait for ChromaDB (health check: started)
3. Load environment variables
4. Generate `chat-widget-config.js` from environment
5. Connect to MongoDB (with retries)
6. Create default admin user if none exists
7. Migrate existing users if needed
8. Connect to Redis
9. Connect to ChromaDB and initialize collections
10. Start conversation timeout service (5-min inactivity checker)
11. Connect to Mattermost WebSocket (if configured)
12. Start Uvicorn server on port 8007

### 24.4 Why Single Worker?

`docker-compose.yml` runs with `--workers 1` even though the Dockerfile has `--workers 4`.

**Reason:** Socket.IO maintains WebSocket connection state in memory. With multiple workers, a client might connect to worker 1 but have their next request routed to worker 2, which doesn't know about the connection. The Redis adapter helps broadcast events, but connection state is per-worker. Single worker guarantees consistency. This is a standard Socket.IO deployment pattern.

### 24.5 Nginx Configuration (Dashboard)

```
Port 3006
├── /           → React SPA (try_files → /index.html)
├── /api/       → Proxy to medinovai-chatbot:8007
├── /static/    → Proxy to medinovai-chatbot:8007
├── /socket.io/ → Proxy to medinovai-chatbot:8007 (WebSocket upgrade)
└── /assets/    → Static files with 1-year cache
```

---

## 25. Environment Variables

### Core Server

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_ENV` | development | Environment mode |
| `API_PORT` | 8007 | Backend server port |
| `HOST_URL` | moschat.myonsitehealthcare.com | Public hostname |
| `BACKEND_URL` | (required) | Full backend URL for CORS and config |
| `FRONTEND_URL` | (required) | Dashboard URL for CORS |
| `WEBSOCKET_PROTOCOL` | ws | ws or wss |
| `SECRET_KEY` | (required) | JWT signing and session encryption |
| `ADDITIONAL_CORS_ORIGINS` | localhost variants | Extra allowed CORS origins |
| `LOG_LEVEL` | INFO | Logging level |

### AI/LLM

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENAI_API_KEY` | (required) | OpenAI API authentication |
| `OPENAI_MODEL` | gpt-4-1106-preview | Default LLM model |
| `FAST_MODEL` | gpt-4-turbo-preview | Fast model for simple queries |
| `THINKING_MODEL` | o3-mini-2025-01-31 | Thinking model for complex queries |
| `ENABLE_SMART_ROUTING` | true | Toggle fast/thinking model routing |
| `TEMPERATURE` | 0.7 (config) / 0.3 (prod docker) | LLM temperature |
| `OPENAI_MAX_TOKENS` | 300 | Maximum response tokens |
| `TEXT_LLM_MODEL` | gpt-4-1106-preview | Text generation model |
| `ANTHROPIC_API_KEY` | (optional) | Anthropic Claude API key (backup) |
| `LLAMACLOUD_API_KEY` | (optional) | LlamaCloud for document parsing |

### Database

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGO_URI` | (required) | MongoDB connection string |
| `MONGODB_DB_NAME` | medinovai_chatbot | MongoDB database name |
| `REDIS_URL` | redis://:pass@localhost:6379 | Redis connection URL |
| `REDIS_PASSWORD` | (in docker-compose) | Redis password |
| `VECTOR_DB_URL` | http://localhost:8000 | ChromaDB URL |

### RAG

| Variable | Default | Purpose |
|----------|---------|---------|
| `PERSIST_DIRECTORY` | — | Local vector store persistence |
| `TARGET_SOURCE_CHUNKS` | 4 | Number of RAG chunks to retrieve |
| `CHUNK_SIZE` | 1000 | Document chunk size (characters) |
| `CHUNK_OVERLAP` | 50 | Chunk overlap (characters) |
| `EMBEDDING_MODEL` | text-embedding-3-small | Configured embedding model |
| `ENABLE_RAG` | false | Toggle RAG on/off |

### Mattermost

| Variable | Purpose |
|----------|---------|
| `MATTERMOST_URL` | Server URL |
| `MATTERMOST_WS_URL` | WebSocket URL |
| `MATTERMOST_TOKEN` | Bot/admin token |
| `MATTERMOST_CHANNEL_ID` | Default notification channel |
| `MATTERMOST_DEFAULT_TEAM_ID` | Team for new channels |
| `BYDEFAULT_MEMBERS` | Auto-added to handoff channels |
| `NOTIFY_MEMBERS` | Notified on escalation |
| `MANDATORY_MEMBER` | Always added to channels |
| `HANDOFF_TIMEOUT_MINUTES` | Unclaimed handoff timeout (default: 2) |
| `SUMMARY_MAX_MESSAGES` | Messages in handoff summary (default: 10) |

### 3CX

| Variable | Purpose |
|----------|---------|
| `THREE_CX_ENABLE` | Toggle 3CX integration |
| `THREE_CX_SERVER_URL` | 3CX server URL |
| `THREE_CX_API_KEY` | API authentication key |
| `THREE_CX_API_USERNAME` | API username |
| `THREE_CX_API_PASSWORD` | API password |
| `USERNAME_MATCHING_STRATEGY` | How to match extensions to agents |
| `MATCHING_CONFIDENCE_THRESHOLD` | Matching confidence (default: 0.4) |
| `ENABLE_FUZZY_MATCHING` | Toggle fuzzy username matching |
| `FALLBACK_TO_MATTERMOST` | Use Mattermost when 3CX unavailable |

### Email (AWS SES)

| Variable | Purpose |
|----------|---------|
| `SMTP_SERVER` | email-smtp.us-east-1.amazonaws.com |
| `SMTP_PORT` | 587 |
| `EMAIL_USERNAME` | SMTP username |
| `EMAIL_PASSWORD` | SMTP password |
| `SENDER_EMAIL` | From address |
| `RECEIVER_EMAIL` | Default recipient |
| `EMAIL_SEND_ON_APPOINTMENT` | Send confirmation on appointment |
| `EMAIL_SEND_ON_ESCALATION` | Send alert on escalation |

### External APIs

| Variable | Purpose |
|----------|---------|
| `ZIP_CODE_API_KEY` | ZIP code validation API |
| `COMMON_GATEWAY` | CommonGateway API for service area |
| `OCR_API_URL` | OCR service for prescription scanning |
| `OCR_API_KEY` | OCR API authentication |
| `PROVIDER_API_URL` | Provider data API |
| `API_GATEWAY_PATIENT_TOKEN` | Patient API gateway token |

### Dashboard (Vite Build-Time)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend URL for dashboard |
| `VITE_WEBSOCKET_URL` | WebSocket URL for dashboard |
| `VITE_KEYCLOAK_URL` | Keycloak server URL |
| `VITE_KEYCLOAK_REALM` | Keycloak realm name |
| `VITE_KEYCLOAK_CLIENT_ID` | Keycloak client ID |
| `VITE_DASHBOARD_PORT` | Dashboard port (3006) |

### Security

| Variable | Default | Purpose |
|----------|---------|---------|
| `RATE_LIMIT_PER_DAY` | 200 | Max requests per IP per day |
| `RATE_LIMIT_PER_HOUR` | 50 | Max requests per IP per hour |
| `MAX_FILE_SIZE` | 10MB | Maximum upload file size |

---

## 26. End-to-End Data Flow

### 26.1 Patient Sends a Message

```
1. Patient types "Do you accept Aetna?" in chat widget

2. Chat widget sends:
   POST /api/v2/message
   {
     "message": "Do you accept Aetna?",
     "session_id": "temp_A3F2_12032026_143022",
     "client_id": "widget-abc123"
   }

3. Backend (chat_v2.py):
   a. Check Redis: ai_paused:{session_id}? → No, AI is active
   b. Load LangGraph with MongoDB checkpointer
   c. Invoke graph with: { session_id, messages: [HumanMessage("Do you accept Aetna?")] }

4. LangGraph executes:
   a. router_node:
      - Regex check → no greeting/appointment/support match
      - Intent = "rag" (default)

   b. rag_node:
      - SemanticQACache.get_cached_context("Do you accept Aetna?")
      - Generate embedding (all-MiniLM-L6-v2, 384d)
      - Search qa_cache collection in ChromaDB
      - IF similarity >= 0.85: Cache HIT → attach cached context
      - IF similarity < 0.85: Cache MISS → RAGService.query_docs(k=3)
        - Search company_knowledge, faq_responses collections
        - Return top 3 documents above 0.7 similarity
        - Format context (max 2000 chars)

   c. general_chat_node:
      - Build prompt: OPTIMIZED_SYSTEM_PROMPT + RAG context + history
      - Call OpenAI (gpt-4o-mini if cache hit, o3-mini if cache miss)
      - LLM sees tools: [check_zip, lookup_insurance, lookup_patient]
      - LLM decides to call: lookup_insurance("Aetna")
      - Returns: ToolCall message

   d. should_continue_after_llm → tool_calls detected → tool_executor_node

   e. tool_executor_node:
      - Runs lookup_insurance("Aetna")
      - Returns: "Aetna is accepted. Plan types: HMO, PPO, POS"

   f. Back to general_chat_node:
      - LLM sees tool result
      - Generates: "Yes, we accept Aetna insurance including HMO, PPO, and POS
        plans! Would you like to schedule a mobile blood draw appointment?"
      - No more tool calls

   g. post_process_node:
      - EmojiCleaner removes any emojis
      - DashboardSyncService syncs to dashboard via Socket.IO
      - If Mattermost channel exists, forward message
      - SemanticQACache.cache_qa_pair(question, answer, "insurance")
      - SentimentAnalysisService analyzes sentiment → "positive"

5. Response returned to widget:
   {
     "response": "Yes, we accept Aetna insurance including HMO, PPO, and POS plans! Would you like to schedule a mobile blood draw appointment?",
     "intent": "rag",
     "session_id": "temp_A3F2_12032026_143022"
   }

6. LangGraph state persisted to MongoDB checkpointer
7. Widget displays response to patient
```

### 26.2 Agent Monitors via Dashboard

```
1. Agent logs into dashboard at https://dashboard.myonsitehealthcare.com
2. Keycloak authenticates → JWT token issued
3. Dashboard connects Socket.IO to backend
4. Socket.IO events stream in real-time:
   - new_message: every patient message and AI response
   - agent_needed: escalation alerts
   - user_status_changed: other agents going online/offline

5. Agent sees conversation list updating live
6. Can click into any conversation to see full history
7. Can send messages directly to patients
8. Can claim escalated conversations
9. Can view analytics, search conversations, export data
```

---

## 27. Key Design Decisions and Reasoning

| Decision | Why | Trade-off |
|----------|-----|-----------|
| **LangGraph over raw OpenAI API** | Need stateful conversations with branching, tool loops, and persistence. Building this manually would take months. | Added dependency on LangChain ecosystem; learning curve for team. |
| **Two chat versions (v1 + v2)** | v1 (CleanChatService) is the legacy path; v2 (LangGraph) is the new architecture. Both kept for backward compatibility during migration. | Code duplication; maintenance burden of two paths. |
| **Semantic QA Cache** | Same questions asked daily were costing too much ($0.01-0.03 each × hundreds/day). Cache reduces to $0.001-0.003 per cached hit. | Cache invalidation complexity; entity bypass logic needed for accuracy. |
| **Character-based truncation over token counting** | Simpler, faster, and good enough. Never near context limits. | Less precise; could theoretically overflow on edge cases (handled by error catch). |
| **Local embeddings (all-MiniLM-L6-v2) over OpenAI embeddings** | Zero cost, zero latency, no network dependency. Quality is sufficient for company FAQ. | Lower quality than OpenAI text-embedding-3-small; 384d vs 1536d. |
| **Redis for sessions, MongoDB for persistence** | Redis: sub-millisecond reads during real-time chat. MongoDB: durable storage for conversation history. | Two databases to maintain; data sync complexity. |
| **Mattermost for agent chat** | Agents already use it internally; no new tool to learn; self-hosted (HIPAA). | Dependency on Mattermost infrastructure; WebSocket complexity. |
| **3CX presence check** | No point escalating to agents on phone calls. Saves agents from getting pinged when busy. | External API dependency; fallback needed when 3CX is down. |
| **Vanilla JS chat widget** | Must embed on any website without framework requirements. Zero dependencies = universal compatibility. | Harder to maintain than React; no component reuse; manual DOM manipulation. |
| **Single Docker worker** | Socket.IO WebSocket state is per-process. Multi-worker breaks real-time connections. | Cannot scale backend horizontally without moving to a different real-time architecture. |
| **Keycloak over custom auth** | Already in company infrastructure; SSO across apps; battle-tested security; OIDC/SAML support. | Heavy deployment (Java); complex configuration; overkill if only one app. |
| **ChromaDB over Pinecone** | Self-hosted (data stays on-prem); free; sufficient for hundred-document knowledge base. | Would not scale to millions of documents; no managed backup/monitoring. |
| **Regex intent detection in router_node** | Fast, deterministic, no LLM call needed. Greetings, appointment keywords, and support requests are easily pattern-matched. | Cannot handle nuanced or ambiguous intents; falls back to "rag" for everything else. |
| **Temperature 0.3 in production** | More deterministic, consistent responses for customer service. Less "creative" randomness. | May sound repetitive for frequent users; less personality. |

---

## 28. Directory Structure

```
MedinovAI-Chatbot/
├── .env                              # Environment variables (gitignored)
├── .dockerignore                     # Docker build exclusions
├── .gitignore                        # Git ignore rules
├── .hadolint.yaml                    # Dockerfile linting config
├── chat-widget-config.js             # Root copy of widget config
├── chat-widget.css                   # Root copy of widget styles
├── chat-widget.html                  # Root copy of widget HTML
├── chat-widget.js                    # Root copy of widget JS
├── chat-widget-NEW.js                # Experimental widget version
├── deploy.sh                         # Deployment script (dev/prod)
├── docker-compose.yml                # Multi-container orchestration
├── docker-entrypoint.sh              # Container entrypoint (wait for deps)
├── docker-startup.sh                 # Wait for services and start app
├── Dockerfile                        # Multi-stage build (dashboard + backend)
├── env.example                       # Environment variable template
├── package.json                      # Root npm dependencies
├── pyproject.toml                    # Python tooling config (black, isort, flake8)
├── README.md                         # Project README
├── requirements.txt                  # Python dependencies
├── start_chatbot.sh                  # Start with Docker Compose
├── start_server.py                   # Local dev server (Uvicorn on 8007)
├── start.sh                          # Simple start script
│
├── dashboard/                        # React Admin Dashboard
│   ├── Dockerfile                    # Dashboard-only Dockerfile
│   ├── index.html                    # Vite HTML entry
│   ├── nginx.conf                    # Nginx config for serving + proxying
│   ├── package.json                  # Dashboard dependencies
│   ├── package-lock.json
│   ├── postcss.config.js             # PostCSS for Tailwind
│   ├── tailwind.config.js            # Tailwind CSS config
│   ├── tsconfig.json                 # TypeScript config
│   ├── vite.config.ts                # Vite build config
│   ├── build-prod.sh                 # Production build script
│   └── src/
│       ├── App.tsx                   # Root React component
│       ├── index.tsx                 # Entry point
│       ├── routes.tsx                # Route definitions + guards
│       ├── keycloak.ts               # Keycloak singleton config
│       ├── api/                      # 13 API client modules
│       ├── components/               # UI components
│       │   ├── analytics/            # Charts, metrics
│       │   ├── common/               # Shared components
│       │   ├── conversations/        # Conversation list + detail
│       │   ├── dashboard/            # Dashboard widgets
│       │   ├── layout/               # Header, sidebar, layout
│       │   ├── notifications/        # Notification components
│       │   ├── settings/             # Settings pages
│       │   └── users/                # User management
│       ├── contexts/                 # React contexts (auth, websocket, escalation)
│       ├── hooks/                    # Custom React hooks
│       ├── services/                 # Service layer
│       ├── types/                    # TypeScript type definitions
│       └── utils/                    # Utility functions
│
├── docs/                             # Documentation
│   ├── COMPANY_DETAILS.md            # myOnsite Healthcare info
│   ├── SEMANTIC_QA_CACHE.md          # QA cache documentation
│   ├── LIS_Integration_API_Specification.md
│   ├── INBOUND_CALL_AGENT_PLAN.md
│   ├── OUTBOUND_CALL_AGENT_PLAN.md
│   └── ...
│
├── scripts/                          # Database setup and maintenance
│   ├── init_dashboard_db.py          # Initialize dashboard database
│   ├── init_admin_user.py            # Create default admin user
│   ├── setup_databases.py            # Full database setup
│   ├── seed_company_knowledge.py     # Seed RAG with company info
│   ├── seed_intent_examples.py       # Seed intent examples
│   ├── populate_rag_knowledge.py     # Populate RAG knowledge base
│   ├── create_text_indexes.py        # Create MongoDB indexes
│   ├── backup_database.py            # Database backup
│   ├── clean_*.py                    # Various cleanup scripts
│   └── ...
│
├── src/                              # Python Backend
│   ├── main.py                       # FastAPI + Socket.IO entry point
│   ├── socket_instance.py            # Socket.IO singleton
│   ├── Dockerfile                    # Backend-only Dockerfile
│   │
│   ├── api/routes/                   # 40+ route modules
│   │   ├── chat.py                   # Legacy chat endpoint
│   │   ├── chat_v2.py                # LangGraph chat endpoint
│   │   ├── clean_chat.py             # Production chat endpoint
│   │   ├── appointments.py           # Appointment CRUD
│   │   ├── orders.py                 # Order validation
│   │   ├── agent_escalation.py       # Escalation endpoints
│   │   ├── agent_status.py           # Agent status management
│   │   ├── dashboard_auth.py         # Dashboard authentication
│   │   ├── dashboard_conversations.py
│   │   ├── dashboard_analytics.py
│   │   ├── dashboard_users.py
│   │   ├── dashboard_export.py
│   │   ├── dashboard_search.py
│   │   ├── dashboard_settings.py
│   │   ├── mattermost_routes.py
│   │   ├── patient_data.py
│   │   ├── patient_data_v2.py
│   │   ├── upload.py
│   │   ├── email.py
│   │   ├── feedback.py
│   │   ├── health.py
│   │   ├── monitoring.py
│   │   ├── vector.py
│   │   ├── webhooks.py
│   │   ├── prescription.py
│   │   ├── notifications.py
│   │   └── ...
│   │
│   ├── core/                         # Core infrastructure
│   │   ├── config.py                 # Pydantic settings + all config
│   │   ├── redis_client.py           # Async Redis connection
│   │   ├── vector_db.py              # ChromaDB + embedding abstraction
│   │   ├── websocket_manager.py      # WebSocket + Socket.IO management
│   │   ├── master_prompts.py         # Full system prompts (~16K tokens)
│   │   ├── optimized_prompts.py      # Optimized prompts (~2K tokens)
│   │   └── compact_prompts.py        # Compact prompts (~500 tokens)
│   │
│   ├── graph/                        # LangGraph conversation engine
│   │   ├── graph.py                  # Graph builder + MongoDB checkpointer
│   │   ├── nodes.py                  # All node implementations
│   │   ├── state.py                  # ChatState schema
│   │   └── tools.py                  # LLM tools (ZIP, insurance, patient lookup)
│   │
│   ├── middleware/                    # Security + auth middleware
│   │   ├── auth_middleware.py         # Basic auth (dev mode)
│   │   ├── dashboard_auth_middleware.py  # Keycloak session validation
│   │   ├── enhanced_auth.py          # Rate limit, security headers, sanitization
│   │   ├── rbac_decorator.py         # Role-based access control decorators
│   │   └── storage_middleware.py      # MongoDB storage (disabled)
│   │
│   ├── models/                       # Pydantic data models
│   │   ├── session_models.py         # Chat state, session, conversation, user
│   │   └── dashboard_user_models.py  # Dashboard user, role, permissions
│   │
│   ├── services/                     # 69 service modules (see Section 19)
│   │
│   ├── static/                       # Chat widget files
│   │   ├── chat-widget.html
│   │   ├── chat-widget.js
│   │   ├── chat-widget-config.js     # Auto-generated from .env
│   │   ├── chat-widget.css
│   │   ├── diagnostic-logger.js
│   │   └── medinovai-logo.png
│   │
│   └── utils/                        # Utility modules (see Section 23)
│
├── static/                           # Root static copies
│   ├── chat-widget-config.js
│   ├── chat-widget.css
│   └── diagnostic-logger.js
│
└── test-results/
    └── .last-run.json
```

---

## Quick Reference Card

| Question | Answer |
|----------|--------|
| What is it? | AI chatbot for myOnsite Healthcare (mobile phlebotomy) |
| Bot name? | Carevio |
| Backend? | FastAPI (Python 3.11) + Uvicorn |
| AI? | OpenAI GPT (gpt-4o-mini fast, o3-mini thinking) |
| Orchestration? | LangGraph (stateful conversation graphs) |
| Vector DB? | ChromaDB (cosine similarity, HTTP API) |
| Embeddings? | all-MiniLM-L6-v2 (384d, local, free) |
| Primary DB? | MongoDB (conversations, users, appointments) |
| Cache? | Redis 7 (sessions, rate limiting, pub/sub) |
| Dashboard? | React 18 + TypeScript + Vite + Tailwind |
| Auth? | Keycloak SSO (OIDC) |
| Real-time? | Socket.IO (Redis adapter) |
| Chat widget? | Vanilla JS (zero dependencies) |
| Agent chat? | Mattermost integration |
| Phone presence? | 3CX PBX REST API |
| Deployment? | Docker + Docker Compose (4 services) |
| Ports? | Backend 8007, Dashboard 3006, Redis 6383, ChromaDB 8003 |
| Smart routing? | QueryComplexityClassifier (regex heuristic) |
| Cost optimization? | Semantic QA Cache (~70% cost reduction) |
| Token management? | Character-based truncation (not token counting) |
| Max response tokens? | 300 (standard), 1000 (thinking models) |
| RAG chunks? | 1000 chars, 50 overlap, top-3 retrieval |
| Cache threshold? | 0.85 cosine similarity |
| Workers? | 1 (Socket.IO constraint) |

---

## 29. How to Scale This System

### 29.1 Current Bottlenecks

| Bottleneck | Why | Impact |
|-----------|-----|--------|
| Single Uvicorn worker | Socket.IO keeps WebSocket state in memory; multiple workers break connections | Cannot horizontally scale the backend process |
| OpenAI API latency | 1-10 seconds per LLM call depending on model | Concurrent users wait in queue |
| MongoDB (external) | Single connection string, no read replicas configured | Read-heavy analytics queries compete with write-heavy chat |
| ChromaDB (single instance) | No clustering or replication | Vector search is a single point of failure |
| In-memory caches | Session locks, rate limit stores, presence cache are process-local | Cannot share state across multiple instances |

### 29.2 Vertical Scaling (Scale Up)

The easiest first step — give the existing server more resources:

| Action | Effect |
|--------|--------|
| Increase CPU cores | Faster concurrent async I/O handling within the single worker |
| Increase RAM | More in-memory cache capacity, larger embedding model loading |
| Use faster storage (NVMe SSD) | Faster MongoDB and ChromaDB disk I/O |
| GPU (optional) | Faster local embedding generation with sentence-transformers |

### 29.3 Horizontal Scaling (Scale Out)

To run multiple backend instances:

```
                    ┌──────────────┐
                    │ Load Balancer│  (Nginx / AWS ALB)
                    │ (sticky      │
                    │  sessions)   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │Worker 1 │ │Worker 2 │ │Worker 3 │
         │Port 8007│ │Port 8008│ │Port 8009│
         └────┬────┘ └────┬────┘ └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌─────────┐ ┌─────────┐ ┌─────────┐
         │ Redis   │ │ MongoDB │ │ChromaDB │
         │ (shared)│ │ (shared)│ │ (shared)│
         └─────────┘ └─────────┘ └─────────┘
```

**Steps to enable horizontal scaling:**

1. **Replace Socket.IO with SSE or separate WebSocket service** — The main blocker is Socket.IO's in-memory state. Options:
   - Use Socket.IO's Redis adapter (already in place) and enable sticky sessions on the load balancer so the same client always hits the same worker
   - Move WebSocket handling to a dedicated service (e.g., a separate Socket.IO server backed by Redis pub/sub)
   - Replace Socket.IO with Server-Sent Events (SSE) for server-to-client + HTTP POST for client-to-server (stateless)

2. **Move all session state to Redis** — Currently some state is in-memory (`_session_locks`, `_rate_limit_store`, presence cache). Move all to Redis so any worker can handle any request.

3. **MongoDB replica set** — Configure read replicas for analytics queries; writes go to primary.

4. **ChromaDB alternatives** — For high-scale, replace ChromaDB with Qdrant or Pinecone (supports horizontal scaling and replication natively).

5. **Multiple Uvicorn workers with sticky sessions:**
   ```bash
   uvicorn main:socket_app --host 0.0.0.0 --port 8007 --workers 4
   ```
   With Nginx sticky sessions (based on session_id cookie or IP hash).

### 29.4 Scaling Individual Components

| Component | Current | Scaled Version |
|-----------|---------|---------------|
| **Backend** | 1 worker | Multiple workers behind load balancer with sticky sessions |
| **Redis** | Single instance | Redis Cluster (6+ nodes) or Redis Sentinel (master/replica) |
| **MongoDB** | Single instance | Replica set (1 primary + 2 secondaries) or MongoDB Atlas |
| **ChromaDB** | Single instance | Qdrant cluster or Pinecone (managed) |
| **Dashboard** | Single Nginx | Multiple Nginx replicas behind CDN (static assets) |
| **Mattermost** | Single instance | Mattermost High Availability (multiple app nodes + shared DB) |

### 29.5 Microservices Decomposition (Long-Term)

For very high scale, split the monolith:

| Service | Responsibility |
|---------|---------------|
| **Chat API** | Message handling, LangGraph, RAG |
| **Real-Time Service** | Socket.IO/WebSocket connections only |
| **Dashboard API** | Dashboard-specific endpoints |
| **Worker Service** | Background tasks (timeout, analytics, email) |
| **Embedding Service** | Dedicated embedding generation (GPU) |

---

## 30. How to Reduce Token Usage

### 30.1 Current Token Consumption

| Component | Tokens Per Request (Approx.) |
|-----------|------------------------------|
| System prompt (optimized) | ~2,000 |
| RAG context | ~500 |
| Conversation history (10 messages) | ~1,000-2,000 |
| Tool definitions | ~300 |
| Max output | 300-1,000 |
| **Total per request** | **~4,100-5,800** |

### 30.2 Reduction Strategies

**Strategy 1: Conversation History Summarization**
- Instead of sending the last N raw messages, periodically summarize older messages into a condensed paragraph
- Keep last 3 messages verbatim + summary of prior conversation
- Savings: ~40-60% of history tokens
- Implementation: `ConversationSummarizationService` already exists but is not used in the main LangGraph path

**Strategy 2: Use Compact Prompt for Simple Queries**
- The system always sends the ~2,000-token optimized prompt
- For simple queries (greetings, yes/no, thanks), use the 500-token compact prompt instead
- Savings: ~1,500 tokens per simple request (~75% of prompt tokens)
- Implementation: The `QueryComplexityClassifier` already classifies queries; use it to select prompt tier

**Strategy 3: Reduce RAG Context**
- Currently retrieves k=3 documents, each truncated to 500 chars
- For high-confidence semantic cache hits (>0.92), skip RAG entirely
- For simple queries that don't need knowledge (greetings, appointment status), skip RAG
- Savings: ~500 tokens per non-RAG request

**Strategy 4: Token-Aware History Trimming**
- Replace character-based truncation with actual token counting using `tiktoken` (already in dependencies but unused)
- Set a token budget (e.g., 4,000 tokens for input) and trim oldest messages first
- Prevents both waste (sending too little) and overflow (sending too much)

**Strategy 5: Tool Definition Optimization**
- Only include relevant tools based on conversation state
- During greeting → no tools needed
- During appointment flow → only `check_zip_serviceability`
- During insurance question → only `lookup_insurance`
- Savings: ~200 tokens when tools are filtered

**Strategy 6: Cache More Aggressively**
- Lower the semantic cache threshold from 0.85 to 0.80 (more cache hits)
- Cache appointment flow responses (same flow every time)
- Cache static responses (company info, insurance list, service list)
- Savings: Each cache hit saves ~3,000-4,000 tokens (uses fast model with cached context)

**Strategy 7: Use Cheaper Models**
- gpt-4o-mini costs ~$0.15/1M input tokens vs gpt-4 at ~$30/1M
- For the current workload, gpt-4o-mini handles most queries well
- Reserve o3-mini only for truly complex, first-time questions

**Strategy 8: Structured Output**
- Use OpenAI's JSON mode to get structured responses
- Eliminates the need for post-processing to extract intent, entities, etc.
- Fewer retry calls due to malformed responses

### 30.3 Projected Savings

| Strategy | Token Reduction | Cost Impact |
|----------|----------------|-------------|
| History summarization | -40% of history | ~15% total reduction |
| Compact prompt for simple queries | -1,500 per simple query | ~20% total reduction |
| Skip RAG for non-knowledge queries | -500 per greeting/status | ~10% total reduction |
| Tool filtering | -200 per non-tool query | ~5% total reduction |
| Lower cache threshold | More cache hits → fast model | ~20% cost reduction |
| **Combined** | — | **~50-60% total cost reduction possible** |

---

## 31. LangGraph Features — Detailed Breakdown

### 31.1 Features Currently Used

| Feature | Where | What It Does |
|---------|-------|-------------|
| **StateGraph** | `graph/graph.py` | Core graph builder — defines nodes, edges, and conditional routing |
| **MessagesState** | `graph/state.py` | Built-in message list management with `add_messages` reducer — automatically appends new messages to history |
| **START / END** | `graph/graph.py` | Entry and exit points of the graph |
| **add_node()** | `graph/graph.py` | Registers 10 node functions (router, rag, general_chat, tool_executor, greeting, appointment_trigger, edit_appointment, handoff, paused, post_process) |
| **add_edge()** | `graph/graph.py` | Direct edges between nodes (e.g., `rag → general_chat`, `greeting → post_process`) |
| **add_conditional_edges()** | `graph/graph.py` | Two conditional routing points: (1) router → intent-based branching, (2) general_chat → tool loop or post_process |
| **MongoDB Checkpointer** | `graph/graph.py` | `MongoDBSaver` persists full conversation state to MongoDB; restores state on next message for same session |
| **ainvoke()** | `chat_v2.py` | Async graph invocation — runs the full pipeline and returns final state |
| **astream_events()** | `chat_v2.py` | Async event streaming — streams LLM tokens as they are generated for real-time response display |
| **aget_state()** | `chat_v2.py` | Reads persisted state from checkpointer without running the graph (for history endpoint) |
| **configurable.thread_id** | `chat_v2.py` | Maps `session_id` to LangGraph's thread concept for state isolation per conversation |
| **bind_tools()** | `graph/nodes.py` | Binds LangChain `@tool` functions to the LLM so it can call them during generation |
| **Tool-calling loop** | `graph/nodes.py` | `general_chat → tool_executor → general_chat` loop continues until LLM stops requesting tools |
| **Custom state fields** | `graph/state.py` | 10 custom fields beyond `messages`: session_id, intent, collected_data, appointment_active, appointment_step, ai_paused, mattermost_channel_id, rag_context, sentiment, response_metadata |

### 31.2 Features NOT Used (Available in LangGraph)

| Feature | What It Does | Why Not Used | Could Help With |
|---------|-------------|-------------|----------------|
| **ToolNode** | Built-in node that automatically executes tool calls from LLM messages | Custom `tool_executor_node` was written instead for more control over error handling and logging | Simplifying code; less custom code to maintain |
| **Human-in-the-loop (interrupt_before / interrupt_after)** | Pauses graph execution at a specific node, waits for human input, then resumes | Human handoff is implemented via Redis `ai_paused` flag + Mattermost, outside the graph | Could replace the current handoff mechanism with native LangGraph interrupts — cleaner architecture |
| **Breakpoints** | Debug pause points in the graph | Not needed in production | Debugging graph issues |
| **Subgraphs** | Nested graphs within nodes — encapsulate complex flows | Flat graph is sufficient for current complexity | Could encapsulate appointment flow as a subgraph for cleaner separation |
| **Map-Reduce** | Parallel execution of multiple branches, then merge results | No parallel processing needed currently | Could parallelize RAG search across multiple collections simultaneously |
| **Send / Parallel branches** | Fork execution into multiple parallel paths | All nodes run sequentially | Could run RAG + sentiment analysis in parallel |
| **Time-Travel (get_state_history)** | Browse and replay previous states of a conversation | Not implemented | Debugging conversation issues; "undo" functionality |
| **Command** | Dynamic routing from within a node (node returns next destination) | Conditional edges handle all routing | More flexible routing without predefined edge maps |
| **Stream modes (values, updates, debug)** | Different streaming granularities | Only `astream_events` with `version="v2"` is used | Could stream state updates per node for dashboard real-time visualization |
| **Message trimming** | Built-in `trim_messages` utility to limit conversation history by token count | Manual history slicing is used instead | More precise token management |
| **Retry policies** | Built-in retry for failed nodes | Custom try/catch in each node | Cleaner error recovery |
| **State reducers** | Custom merge logic for state fields | Only `messages` uses the built-in `add_messages` reducer; other fields are overwritten | Could use reducers for `collected_data` to merge partial updates |

### 31.3 LangChain Components Used

| Component | Import | Purpose |
|-----------|--------|---------|
| `ChatOpenAI` | `langchain_openai` | OpenAI LLM client with tool support |
| `HumanMessage` | `langchain_core.messages` | Represents user input in message list |
| `AIMessage` | `langchain_core.messages` | Represents LLM output in message list |
| `SystemMessage` | `langchain_core.messages` | System prompt prepended to conversation |
| `ToolMessage` | `langchain_core.messages` | Tool execution result returned to LLM |
| `@tool` decorator | `langchain_core.tools` | Declares Python functions as LLM-callable tools |
| `bind_tools()` | `ChatOpenAI` method | Attaches tool definitions to the LLM |
| `RecursiveCharacterTextSplitter` | `langchain.text_splitter` | Splits documents into chunks for RAG |

---

## 32. Concurrency, Race Conditions, and Multi-User Handling

### 32.1 How Multiple Users Are Handled Simultaneously

The backend uses **async/await (asyncio)** throughout. A single Uvicorn worker can handle hundreds of concurrent connections because:

1. **FastAPI is async** — Each request is an async coroutine; while one request waits for OpenAI API response, others are being processed
2. **Socket.IO is async** — Uses `python-socketio` with async mode
3. **Redis is async** — Uses `redis.asyncio` for non-blocking cache operations
4. **MongoDB is async** — Uses `motor` (async MongoDB driver) for non-blocking database operations
5. **Uvicorn limit** — `limit_concurrency=200` caps maximum concurrent requests

```
                    Uvicorn (single worker, async event loop)
                    ┌──────────────────────────────────────┐
                    │  Request 1: Waiting for OpenAI...     │  ← Not blocking
                    │  Request 2: Querying MongoDB...       │  ← Not blocking
                    │  Request 3: Reading Redis cache...    │  ← Not blocking
                    │  Request 4: Processing response...    │  ← Running on CPU
                    │  Request 5: Waiting for OpenAI...     │  ← Not blocking
                    │  ...up to 200 concurrent requests     │
                    └──────────────────────────────────────┘
```

The bottleneck is CPU-bound work (embedding generation, regex processing) which blocks the event loop. Most time is spent waiting for I/O (OpenAI API, MongoDB, Redis), which does NOT block other requests.

### 32.2 All Locking Mechanisms

| Mechanism | Type | Location | Protects |
|-----------|------|----------|----------|
| **Redis SETNX** (nx=True) | Distributed lock | `agent_escalation_service.py` | Agent claiming — only one agent can claim a conversation; 30s TTL |
| **asyncio.Lock** (Redis init) | Process-local | `redis_client.py` | Double-checked lazy initialization of Redis connection |
| **asyncio.Lock** (per-session) | Process-local | `state_management_service.py` | Per-session state transitions — prevents concurrent state corruption; up to 10K locks, oldest half evicted |
| **threading.Lock** | Process-local | `smart_presence_cache.py` | In-memory presence cache reads/writes |
| **ReadWriteLock** | Process-local | `rag_service.py` | Created but NOT used — intended for concurrent RAG reads with exclusive writes |
| **MongoDB findOneAndUpdate** | Database-level | `session_id_generator.py` | Atomic counter increment for session display IDs |
| **MongoDB update_one + upsert** | Database-level | Multiple services | Atomic create-or-update for conversations, sessions |
| **Redis INCR** | Atomic operation | `conversation_queue_service.py` | Round-robin pointer increment |

### 32.3 Known Race Conditions

| Race Condition | Severity | Where | Details | Mitigation |
|----------------|----------|-------|---------|-----------|
| **LangGraph concurrent invocation** | **High** | `chat_v2.py` | Two messages for the same session_id arriving simultaneously both read the same checkpoint state, execute in parallel, and write — one overwrites the other's state changes | No per-session lock exists in the v2 path. Add Redis distributed lock or asyncio.Lock per session_id before `graph.ainvoke()`. |
| **Round-robin assignment** | Medium | `conversation_queue_service.py` | Two escalations arriving simultaneously read the same pointer, pick the same agent, both increment | Wrap pointer read + agent selection + increment in a Redis Lua script for atomicity. |
| **AI pause timer reset** | Medium | `ai_pause_manager.py` | Multiple Mattermost messages trigger `reset_pause_timer` simultaneously — read-modify-write without locking | Use Redis Lua script or WATCH/MULTI for atomic read-modify-write. |
| **Rate limit check** | Low | `enhanced_redis_service.py` | `GET` then `SETEX`/`INCR` is not atomic — slight over-limit possible under high concurrency | Use Redis Lua script: `local c = redis.call('incr', key); if c == 1 then redis.call('expire', key, window) end; return c` |
| **Conversation timeout** | Low | `conversation_timeout_service.py` | Multiple instances can process the same inactive conversation | Idempotent (status → complete is same result either way), but causes duplicate log entries. Add `{"status": "active"}` guard to the update query. |
| **RAG read/write** | Low | `rag_service.py` | ReadWriteLock exists but is never acquired — concurrent FAISS writes could corrupt the index | Acquire the lock around FAISS operations. Currently ChromaDB handles its own concurrency, so this only affects the unused FAISS fallback. |

### 32.4 How Each Race Condition Should Be Fixed

**LangGraph concurrent invocation (most critical):**
```python
# In chat_v2.py, before graph.ainvoke():
lock_key = f"langgraph:session_lock:{session_id}"
acquired = await redis.set(lock_key, "1", nx=True, ex=60)
if not acquired:
    return {"response": "Processing your previous message, please wait..."}
try:
    result = await graph.ainvoke(input_state, config=config)
finally:
    await redis.delete(lock_key)
```

**Round-robin assignment (Lua script):**
```lua
-- Atomic round-robin in Redis
local pointer = redis.call('INCR', KEYS[1])
local queue_length = tonumber(ARGV[1])
if pointer >= queue_length then
    redis.call('SET', KEYS[1], 0)
    pointer = 0
end
return pointer
```

---

## 33. Known Issues, Limitations, and Technical Debt

### 33.1 Disabled Features

| Feature | Why Disabled | Impact |
|---------|-------------|--------|
| **StorageMiddleware** | Caused appointment flow state machine corruption | Conversations stored via explicit service calls instead |
| **Redis caching for patient data** | Stale data issues — cached patient data didn't reflect updates | Direct MongoDB queries instead; slightly slower |
| **Response fix logic** | Conflicted with hardcoded appointment responses | Responses not post-processed for consistency |
| **Handoff in clean_chat** | Not working reliably in legacy path | Handoff only works via LangGraph v2 or Mattermost |
| **Production chat routes** | Redis authentication issue | Merged into clean_chat route |
| **Chat debug endpoint** | MongoDB API issue | No debug endpoint available |

### 33.2 Incomplete Features (TODOs)

| Feature | Status |
|---------|--------|
| Dashboard analytics CSV/PDF export | Returns "Export feature coming soon" |
| FAQ management CRUD | Returns "FAQ management coming soon" |
| Conversation export from dashboard | TODO in ConversationInterface.tsx |
| Conversation archive | TODO in ConversationInterface.tsx |
| Real agent response time calculation | Placeholder values |
| Real satisfaction score from feedback | Placeholder values |
| Real hours active tracking | Placeholder values |
| Skill-based agent assignment | TODO when agent skills are implemented |
| Production JWT validation in auth_middleware | Currently returns test user for any token |

### 33.3 Technical Debt

| Debt Item | Details |
|-----------|---------|
| **Two chat architectures** | v1 (CleanChatService) and v2 (LangGraph) coexist; v1 is ~4600 lines in `clean_chat.py` |
| **Debug logging in production** | Many `logger.warning("[DEBUG]...")` and `logger.info("INTENT DEBUG...")` statements |
| **Broad exception handling** | `except Exception` in many places; bare `except:` in ~15 locations hides real bugs |
| **Hardcoded credentials** | 3CX password in config, API tokens in service_area.py, Redis password in defaults |
| **In-memory state** | OTP storage, session rate limits, presence cache not backed by Redis |
| **Deprecated code** | `AsyncMongoDBSaver` fallback, legacy role normalization, `inflight` npm package |
| **Socket.IO instance confusion** | Dashboard WebSocket service warns about "Using get_socketio() fallback (WRONG - different instance!)" |

### 33.4 Security Concerns

| Concern | Severity | Details |
|---------|----------|---------|
| 3CX credentials hardcoded | High | Password visible in code; documented as "SECURITY RISK" |
| Auth middleware bypassed | High | Returns fixed test user for any token in dev mode; must be properly configured for production |
| Hardcoded API tokens | Medium | Service area API token fallback hardcoded |
| No input validation on some endpoints | Medium | Some dashboard endpoints lack Pydantic request models |
| Broad CORS defaults | Low | Localhost variants in default CORS origins |

### 33.5 Resilience Patterns

| Pattern | Where Used | Fallback |
|---------|-----------|----------|
| Redis unavailable | Enhanced Redis Service | In-memory dict (10K items, 1h TTL) |
| ChromaDB unavailable | Vector DB, Semantic Cache | RAG skipped; direct LLM response |
| MongoDB unavailable | Main startup | App fails to start (no fallback) |
| OpenAI API error | OpenAI Service | Branded error message returned to user |
| Mattermost unavailable | Mattermost Service | Handoff proceeds without Mattermost channel |
| 3CX unavailable | Presence Manager | Falls back to Mattermost online status |
| Embedding failure | Vector DB | Zero-vector fallback (384 dimensions of zeros) |
| Service area API down | Service Area Agent | Hardcoded ZIP list fallback (if configured) |
| Context length exceeded | OpenAI Service | Caught; fallback response returned |

---

## 34. 100 Questions and Answers for Presentation Q&A

### Architecture and Design (Questions 1-15)

**Q1: Why did you choose a monolithic architecture instead of microservices?**
A: At current scale (single deployment, <1000 daily users), a monolith is simpler to deploy, debug, and maintain. Docker Compose runs 4 containers (backend, dashboard, Redis, ChromaDB) which is manageable. Microservices would add network latency between services, require service discovery, distributed tracing, and API gateways — complexity not justified yet. The codebase is organized into services/ modules that can be extracted into microservices later if needed.

**Q2: Why FastAPI and not Django or Flask?**
A: FastAPI is async-native (critical for handling many concurrent chat sessions waiting on OpenAI API), has automatic OpenAPI documentation, Pydantic validation for request/response schemas, and first-class WebSocket support. Django would bring an ORM we don't need (we use MongoDB), and Flask lacks native async support — we'd need Celery for background tasks. FastAPI's performance is 2-3x better than Flask for async I/O workloads.

**Q3: Why Python and not Node.js or Go?**
A: The entire AI/ML ecosystem (OpenAI SDK, LangChain, LangGraph, sentence-transformers, ChromaDB, tiktoken) is Python-first. Using Node.js would mean inferior library ports or separate Python microservices. Go would be faster but has almost no LLM orchestration libraries. Python's async/await handles our I/O-bound workload well.

**Q4: Why MongoDB and not PostgreSQL?**
A: Conversations are document-shaped (variable-length message arrays, nested metadata). MongoDB's document model maps naturally to chat data without requiring JOIN queries. LangGraph's checkpointer has a native MongoDB implementation (`MongoDBSaver`). PostgreSQL would work (with JSONB columns) but adds schema migration overhead for evolving chat data structures.

**Q5: Why Redis and not just MongoDB for caching?**
A: Redis delivers sub-millisecond reads vs MongoDB's ~1-5ms. For real-time chat where every message checks session state, AI pause status, and rate limits, this matters. Redis also provides pub/sub (used by Socket.IO adapter) and atomic operations (SETNX for agent claiming) that MongoDB doesn't offer natively. MongoDB is our persistence layer; Redis is our speed layer.

**Q6: Why Socket.IO and not raw WebSockets?**
A: Socket.IO provides rooms (group connections by conversation), automatic reconnection (critical for mobile networks), fallback to long-polling (for corporate firewalls blocking WebSocket), and a Redis adapter for multi-worker broadcasting. Raw WebSockets would require building all of this from scratch.

**Q7: Why is the backend limited to a single worker?**
A: Socket.IO maintains WebSocket connection state in memory. With multiple workers, a client's WebSocket connects to worker 1, but their next HTTP request might go to worker 2, which doesn't know about the connection. The Redis adapter broadcasts events, but connection ownership is per-worker. Sticky sessions on a load balancer could fix this, but adds deployment complexity. Single worker handles our current load (~200 concurrent users).

**Q8: How does the system handle a backend crash or restart?**
A: Conversation state is persisted in MongoDB via LangGraph's checkpointer after every graph execution. Redis sessions have TTLs. On restart: MongoDB state is intact, Redis recovers from AOF persistence, ChromaDB has persistent volumes. Active WebSocket connections drop but the chat widget auto-reconnects and fetches conversation history from the API.

**Q9: What happens if Redis goes down?**
A: The system has fallbacks. `EnhancedRedisService` switches to an in-memory dictionary (capped at 10K items, 1-hour TTL). Session state falls back to MongoDB. Rate limiting becomes per-process (not shared). Socket.IO adapter falls back to in-process events (no cross-worker broadcasting, but single worker anyway). The system continues working with degraded performance.

**Q10: What happens if ChromaDB goes down?**
A: RAG retrieval and semantic QA cache are skipped. The LLM still generates responses using its training data and the system prompt, but without company-specific knowledge context. Responses may be less accurate for company-specific questions. The system logs a warning and continues.

**Q11: Why do you have two chat endpoints (v1 and v2)?**
A: v1 (`/api/clean/message`) uses `CleanChatService` — a linear processing pipeline. v2 (`/api/v2/message`) uses LangGraph — a stateful graph with conditional routing and tool loops. v2 is the new architecture, but v1 was kept during migration for backward compatibility. Both share the same MongoDB and Redis infrastructure.

**Q12: Why a vanilla JS chat widget instead of React?**
A: The widget embeds on customer websites via a `<script>` tag. If it used React, it would either: (a) require the host site to have React (not guaranteed), (b) bundle React into the widget (adding ~40KB), or (c) use an iframe (harder to style/position). Vanilla JS has zero dependencies, ~15KB total, and works on any website regardless of its framework.

**Q13: Why Keycloak for authentication instead of Auth0 or custom JWT?**
A: Keycloak is self-hosted (HIPAA-friendly — patient data stays on our infrastructure), open-source (no per-user licensing), supports SSO across multiple internal apps, and was already part of the company's infrastructure. Auth0 costs $23/1K users/month and sends data to third-party servers.

**Q14: Why is temperature set to 0.3 in production instead of the default 0.7?**
A: Customer service requires consistent, predictable responses. Higher temperature introduces more randomness — the bot might phrase the same answer differently each time or "hallucinate" creative responses. 0.3 keeps responses factual and consistent while still sounding natural. For a creative writing bot, 0.7-1.0 would be better.

**Q15: Why Docker Compose and not Kubernetes?**
A: We have 4 containers on a single server. Kubernetes adds a control plane, etcd cluster, networking overlay, and significant operational complexity for minimal benefit at this scale. Docker Compose gives us multi-container orchestration, health checks, restart policies, and volume management — everything we need. Kubernetes makes sense when scaling to 10+ services across multiple servers.

### LangGraph and AI (Questions 16-35)

**Q16: Why LangGraph instead of plain LangChain?**
A: LangChain chains execute linearly (A → B → C). Our conversation needs branching (greeting vs appointment vs RAG vs escalation), looping (LLM calls tool → gets result → reasons again), and state persistence (restore conversation on next message). LangGraph is a state machine that supports all three. Building this with raw LangChain would mean writing our own state management, routing, and persistence.

**Q17: What is the LangGraph checkpointer and why MongoDB?**
A: The checkpointer automatically saves the full conversation state (all messages, collected data, intent, etc.) after every graph execution. When the same session_id sends another message, the state is restored from the checkpoint. MongoDB was chosen because: (a) it's already our primary database, (b) LangGraph has a native `MongoDBSaver`, (c) document storage fits the variable-shaped state well.

**Q18: How does the tool-calling loop work?**
A: The LLM (OpenAI) can decide it needs to call a function (e.g., `lookup_insurance("Aetna")`). LangGraph detects `tool_calls` in the response, routes to `tool_executor_node` which runs the actual function, returns the result as a `ToolMessage`, then routes back to `general_chat_node` where the LLM sees the result and generates a final human-readable answer. This can loop multiple times if the LLM calls multiple tools sequentially.

**Q19: Why only 3 tools? Why not more?**
A: Each tool definition consumes ~100 tokens in the prompt. More tools = more tokens = higher cost and potentially confusing the LLM about which tool to use. We include only tools that require external data: ZIP validation (external API), insurance lookup (business logic), patient lookup (database). Other operations (appointment scheduling, email) are handled by the prompt and post-processing, not by LLM tool calls.

**Q20: Why regex for intent detection in router_node instead of an LLM call?**
A: Speed and cost. An LLM call takes 1-5 seconds and costs tokens. Regex pattern matching takes <1ms and is free. For clear-cut intents (greetings, "talk to a person", "schedule an appointment"), regex is 99%+ accurate. Ambiguous intents fall through to "rag" (default), where the LLM handles them with full context. This saves an LLM call for ~40% of messages.

**Q21: Why not use LangGraph's built-in ToolNode?**
A: We use a custom `tool_executor_node` for: (a) custom error handling — if a tool fails, we return a friendly error message instead of crashing, (b) logging — we log which tool was called, with what arguments, and the result, (c) control — we can add pre/post-processing around tool execution. `ToolNode` would simplify the code but reduce our control.

**Q22: Why not use LangGraph's human-in-the-loop (interrupt)?**
A: LangGraph's `interrupt_before`/`interrupt_after` pauses the graph mid-execution and waits for human input before resuming. Our human handoff is different — the AI is completely paused (via Redis flag) and a human agent takes over the entire conversation through Mattermost/Dashboard. When the agent is done, AI resumes from scratch (not mid-graph). The Redis-based approach is simpler and doesn't require maintaining a suspended graph execution.

**Q23: What is the `MessagesState` and why extend it?**
A: `MessagesState` is LangGraph's built-in state that manages a list of messages with an `add_messages` reducer — new messages are automatically appended rather than overwriting. We extend it with `ChatState` to add custom fields (session_id, intent, collected_data, appointment state, etc.) that need to persist across graph executions.

**Q24: How does the semantic QA cache decide between fast and thinking models?**
A: Cache HIT (similarity >= 0.85) → fast model (gpt-4o-mini): the answer is already known, just rephrase it. Cache MISS (similarity < 0.85) → thinking model (o3-mini): this is a new question requiring deeper reasoning with RAG context. The thinking model's answer is then cached for future similar questions.

**Q25: What is the QueryComplexityClassifier?**
A: A heuristic classifier (regex + word count, no ML) that determines if a query is simple or complex. Simple: "hi", "thanks", "what are your hours" → fast model. Complex: multi-part questions, comparisons, hypotheticals, 20+ words → thinking model. It runs in <1ms and saves money by not using the expensive model for simple queries.

**Q26: Why two OpenAI models (fast and thinking) instead of one?**
A: Cost and speed optimization. gpt-4o-mini costs ~7x less than o3-mini and responds 2-3x faster. For "Do you accept Medicare?" (simple, answered before), the fast model is sufficient. For "Compare your phlebotomy services in Florida vs Texas and explain insurance differences" (complex, first-time), the thinking model produces better answers. Using one model for everything either wastes money (expensive model for simple queries) or sacrifices quality (cheap model for complex queries).

**Q27: How does the entity bypass in semantic cache work?**
A: Even when a cached question is similar (>= 0.85), the cache is bypassed if the new question contains specific entities not in the cached answer — like a person's name, a specific city, a date, or personal details. This prevents returning "We accept Medicare nationwide" when someone asks "Does John Smith's Medicare plan from Florida cover blood draws at his home on March 15th?" — the specific entities require a fresh, personalized response.

**Q28: What happens when the OpenAI API returns an error?**
A: Multiple fallback layers: (1) Retry logic for transient errors (429 rate limit, 500 server error). (2) If the error is `context_length_exceeded`, a shorter fallback response is returned. (3) For any other error, a branded error message is shown: "I'm having a brief technical issue. Please try again or call (941) 271-0701." The system never shows raw error messages to patients.

**Q29: Why o3-mini and not GPT-4o for the thinking model?**
A: o3-mini is optimized for reasoning tasks — it uses an internal chain-of-thought before responding, producing more accurate answers for complex questions. GPT-4o is a general-purpose model. For our use case (answering healthcare scheduling questions with retrieved context), o3-mini's reasoning capability outperforms GPT-4o while costing less for complex queries due to its efficiency.

**Q30: How is conversation history managed in LangGraph?**
A: LangGraph's `MessagesState` keeps the FULL message history. Every human message, AI response, tool call, and tool result is stored. The checkpointer persists this to MongoDB. There is no automatic trimming — over a long conversation, this grows indefinitely. For token management, the system currently relies on the 128K context window being large enough for typical conversations (10-30 exchanges).

**Q31: Why local embeddings (all-MiniLM-L6-v2) instead of OpenAI embeddings?**
A: Three reasons: (1) Cost — every message and RAG query needs embeddings; OpenAI charges $0.02/1M tokens; local is free. (2) Latency — local embedding takes ~5ms; API call takes ~100ms. (3) Availability — works even if OpenAI API is down. The quality trade-off (384d vs 1536d) is acceptable for company FAQ matching where the documents are well-structured.

**Q32: Why cosine similarity and not Euclidean distance?**
A: Cosine similarity measures the angle between vectors, not their magnitude. This is important for text embeddings because longer texts may have larger magnitude vectors but similar meaning. Cosine similarity normalizes for this, giving more accurate "meaning similarity" scores. It's the standard for text similarity in NLP.

**Q33: What is the RAG retrieval pipeline?**
A: (1) User question is embedded (all-MiniLM-L6-v2, 384d). (2) ChromaDB searches for top-k most similar documents using cosine similarity. (3) Documents below 0.7 similarity are filtered out. (4) Remaining documents are truncated to 500 chars each and concatenated (max 2000 chars total). (5) Context is injected into the LLM prompt as "RAG Context" section. (6) LLM generates a response informed by this context.

**Q34: Why ChromaDB and not Pinecone or Weaviate?**
A: ChromaDB is self-hosted (HIPAA-compliant, data stays on our servers), free (no per-query pricing), Python-native (no separate client libraries), and Docker-ready. Our dataset is small (hundreds of documents). Pinecone would cost money and send data to third-party servers. Weaviate is heavier than needed. For million-document scale, we'd switch to Qdrant or Pinecone.

**Q35: How are documents chunked for RAG?**
A: `RecursiveCharacterTextSplitter` splits documents into 1000-character chunks with 50-character overlap. "Recursive" means it tries splitting on paragraph breaks first, then sentences, then words — preserving natural text boundaries. The 50-char overlap ensures sentences at chunk boundaries aren't lost. These chunks are embedded and stored in ChromaDB.

### Database and Caching (Questions 36-50)

**Q36: Why Redis for sessions instead of storing sessions in MongoDB?**
A: Redis provides sub-millisecond reads (vs 1-5ms for MongoDB), which matters when every chat message checks session state, AI pause status, and rate limits. Redis also provides atomic operations (SETNX for locks, INCR for counters) and pub/sub (for Socket.IO adapter) that MongoDB doesn't offer. MongoDB stores permanent conversation history; Redis stores temporary session state.

**Q37: What happens if a patient sends two messages before the first response comes back?**
A: This is the LangGraph concurrent invocation race condition. Currently, both messages are processed in parallel — both read the same checkpoint state, and the second write overwrites the first. The fix is to add a per-session Redis lock before `graph.ainvoke()`, returning a "please wait" message for the second request. This is a known issue.

**Q38: How does the agent claiming mechanism prevent double-claiming?**
A: Redis `SETNX` (Set if Not eXists) — an atomic operation. `redis.set(lock_key, agent_id, nx=True, ex=30)` only succeeds if the key doesn't exist. The first agent's SETNX succeeds (returns True), the second agent's fails (returns False). Additionally, the MongoDB update query includes `{"status": "pending"}` — if the first claim already changed it to "claimed", the second update matches zero documents.

**Q39: Why MongoDB `findOneAndUpdate` for session ID generation?**
A: We need a globally unique, incrementing counter. `findOneAndUpdate` with `$inc` is atomic — even if two requests arrive simultaneously, each gets a unique incremented value. This is safer than reading the counter, incrementing in Python, and writing back (which has a read-modify-write race).

**Q40: How is rate limiting implemented?**
A: Two levels: (1) Global per-IP rate limiting via `RateLimitMiddleware` — 200/day, 50/hour, Redis-backed. (2) Per-session rate limiting via `clean_chat.py` — 20 messages/minute in normal mode, 60/minute during appointment flow. The global limiter uses Redis INCR with TTL. The per-session limiter uses an in-memory timestamp list.

**Q41: What data is stored in Redis vs MongoDB?**
A: Redis (temporary, fast): session state, user data cache (24h TTL), AI pause flags, Mattermost channel mappings, rate limit counters, Socket.IO adapter state, agent claiming locks. MongoDB (permanent): conversations, appointments, patient records, dashboard users, agent escalations, feedback, LangGraph checkpoints, uploaded documents.

**Q42: How is the MongoDB connection pool managed?**
A: `MongoConnectionPool` provides a shared `pymongo.MongoClient` instance with connection pooling. `motor` (async driver) wraps this for async operations. The pool size is configured by PyMongo's defaults (100 connections). On connection failure, exponential backoff retries up to the configured limit.

**Q43: Why Redis 7 Alpine specifically?**
A: Redis 7 adds performance improvements, new data structures, and better memory management. Alpine Linux is a minimal image (~5MB vs ~100MB for full Debian), reducing attack surface and container size. The `appendonly yes` config enables AOF persistence so Redis data survives restarts.

**Q44: How does the semantic QA cache store data?**
A: In ChromaDB's `qa_cache` collection. Each entry contains: the question text, its 384-dimensional embedding, the answer summary (1000 chars), full answer (2000 chars), extracted keywords, detected intent, and a timestamp. On a new question, the embedding is compared to all cached question embeddings using cosine similarity.

**Q45: What is the Redis fallback mechanism?**
A: `EnhancedRedisService` has an in-memory `_fallback_cache` dictionary (max 10K items, 1-hour TTL). When Redis operations fail, data is read/written to this dict instead. On reconnection, Redis takes over again. This means the system degrades gracefully rather than crashing when Redis is unavailable. The trade-off: in-memory cache is per-process and not shared across workers.

**Q46: How is conversation history stored?**
A: In MongoDB `conversations` collection as a document with a `messages` array. Each message has: sender (user/bot/agent), content, timestamp, and optional metadata (intent, sentiment, tools used). The `$push` operator appends messages atomically. LangGraph also stores its own checkpoint with the full message history in a separate collection.

**Q47: Why not use Redis for the LangGraph checkpointer instead of MongoDB?**
A: LangGraph checkpoints can be large (full conversation history with metadata). Redis is optimized for small, frequently-accessed data with TTLs. MongoDB handles large documents better and provides durability without TTL management. LangGraph's `MongoDBSaver` is a first-party implementation, well-tested and maintained.

**Q48: How are uploaded files stored?**
A: File metadata (name, size, type, session_id) is stored in MongoDB `uploaded_documents` collection. The actual file content is stored on disk in the `chatbot-uploads` Docker volume. The `upload` API endpoint handles multipart form data with a 10MB size limit.

**Q49: What indexes exist on MongoDB?**
A: Text indexes on conversation content for full-text search, compound indexes on `session_id + timestamp` for efficient message retrieval, and TTL indexes for automatic cleanup of old data. Created by `scripts/create_text_indexes.py`.

**Q50: How is data consistency maintained between Redis and MongoDB?**
A: Redis is treated as a cache layer — it's acceptable for Redis data to be slightly stale or lost. The source of truth is always MongoDB. If Redis data is missing, it's reloaded from MongoDB on next access. There's no two-phase commit or distributed transaction between them.

### Frontend and Dashboard (Questions 51-65)

**Q51: Why React with Vite instead of Next.js?**
A: The dashboard is a pure SPA (Single Page Application) — no server-side rendering needed. Next.js adds a Node.js server, file-based routing, and SSR/ISR complexity that we don't need. Vite builds faster than Next.js (native ES modules vs Webpack), and the dashboard is served as static files from Nginx.

**Q52: Why Tailwind CSS instead of Material UI or styled-components?**
A: Tailwind is utility-first — rapid prototyping without writing CSS files. The final bundle only includes used classes (tree-shaking). Material UI would impose Google's design language and add ~100KB to the bundle. styled-components adds runtime CSS-in-JS overhead. Tailwind is lighter and more flexible.

**Q53: How does the dashboard receive real-time updates?**
A: Socket.IO client connects to the backend. Events like `new_message`, `agent_needed`, `user_status_changed` are broadcast by the backend whenever something happens. React components subscribe to these events via the `WebSocketProvider` context and update their state, triggering re-renders.

**Q54: How does Keycloak SSO work with the dashboard?**
A: (1) User visits dashboard. (2) `ProtectedRoute` checks Keycloak session. (3) If not authenticated, redirect to Keycloak login page. (4) User enters credentials (or SSO kicks in). (5) Keycloak issues a JWT. (6) Dashboard stores the JWT. (7) Every API request includes `Authorization: Bearer <JWT>`. (8) Backend validates JWT against Keycloak's JWKS (JSON Web Key Set) endpoint.

**Q55: Why Nginx for serving the dashboard?**
A: Nginx efficiently serves static files (the built React app), handles gzip compression, caching headers, and proxies API/WebSocket requests to the backend. It's the standard reverse proxy for SPAs. The alternative (serving from Node.js) would use more memory and CPU for the same task.

**Q56: How does the dashboard handle role-based access?**
A: `routes.tsx` defines `ProtectedRoute` (requires any authenticated user) and `ManagerRoute` (requires admin or manager role). The role comes from the Keycloak JWT token. Backend endpoints additionally enforce RBAC via `@require_role()` and `@require_permission()` decorators — so even if someone bypasses the frontend guard, the API rejects unauthorized requests.

**Q57: Why Recharts for analytics visualizations?**
A: Recharts is React-native (declarative JSX API), lightweight, and handles the chart types we need (line, bar, pie, area). D3 would be more powerful but requires imperative DOM manipulation that conflicts with React's virtual DOM. Chart.js requires a wrapper library for React.

**Q58: How does the chat widget auto-generate its configuration?**
A: At server startup, `src/utils/config_generator.py` reads environment variables (`BACKEND_URL`, etc.) and writes `chat-widget-config.js` — a JavaScript file that sets `window.CHATBOT_CONFIG`. The widget reads this config object to know where to send API requests. This means the widget automatically adapts to different environments (dev, staging, prod) without code changes.

**Q59: How does the widget handle offline/disconnected state?**
A: The widget periodically polls `GET /api/health`. If it fails, the status indicator shows "Offline" and a `showBackendError()` message appears. `fetchWithTimeout()` wraps all API calls with a timeout. On reconnection, the WebSocket auto-reconnects (Socket.IO's built-in feature) and the widget fetches conversation history to restore the chat.

**Q60: Why not use an iframe for the chat widget?**
A: Iframes provide isolation (widget CSS/JS can't conflict with the host site) but: (a) harder to position (can't easily make a floating bottom-right button), (b) cross-origin communication is complex (postMessage API), (c) some sites block iframes via CSP, (d) the widget needs access to the host page's scroll position for UX. Direct DOM injection with scoped styles is simpler.

**Q61: How does the dashboard search work?**
A: The `searchApi.ts` module calls backend endpoints that use MongoDB text indexes for full-text search across conversations, messages, and patients. The search is server-side — the dashboard sends a query string, and the backend returns matching results. No client-side search index.

**Q62: How are notifications implemented?**
A: Stored in MongoDB `notifications` collection (user_id, type, content, read, pinned, timestamp). The `notificationsApi.ts` polls for unread count. When a new notification is created (e.g., escalation), it's both saved to MongoDB and broadcast via Socket.IO for instant display.

**Q63: Why socket.io-client and not native WebSocket in the dashboard?**
A: Socket.IO provides: (1) automatic reconnection with exponential backoff, (2) room-based events (subscribe to specific conversation updates), (3) fallback to long-polling, (4) client-server protocol matching (must use socket.io-client with python-socketio server). Native WebSocket would need custom reconnection logic and event routing.

**Q64: How is the dashboard built and deployed?**
A: Multi-stage Docker build: (1) Node 18 Alpine runs `npm ci && npm run build` to produce static files in `dist/`. (2) Nginx serves these static files on port 3006. (3) Nginx proxies `/api/` and `/socket.io/` to the backend. Environment variables (API URLs, Keycloak config) are baked in at build time via Vite's `loadEnv`.

**Q65: Why separate Docker containers for dashboard and backend?**
A: Separation of concerns — the dashboard is a static file server (Nginx), while the backend is a Python application server (Uvicorn). They have different resource profiles (dashboard uses minimal CPU/memory; backend uses significant CPU for AI). Separate containers allow independent scaling, updates, and resource limits.

### Integrations (Questions 66-75)

**Q66: Why Mattermost and not Slack for agent handoff?**
A: Mattermost is self-hosted — all patient conversation data stays on our infrastructure (HIPAA compliance). Slack sends data to Salesforce's servers. Mattermost was already used internally by the team, so no new tool to learn. The REST and WebSocket APIs are similar to Slack's, making development straightforward.

**Q67: How does the Mattermost bidirectional message forwarding work?**
A: Patient → Backend → Mattermost: When a patient sends a message while AI is paused, the backend forwards it to the Mattermost channel via REST API. Mattermost → Backend → Patient: `MattermostWebSocket` listens for `posted` events. When an agent posts in the channel, the event handler looks up the session_id from Redis (channel-session mapping) and forwards the message to the patient's WebSocket connection.

**Q68: What is the 3CX integration used for?**
A: Checking agent availability before escalation. 3CX is the company's phone system. The API returns whether each agent (by extension number) is available, busy, on-call, or away. This prevents escalating to an agent who is on a phone call. If 3CX is unavailable, the system falls back to checking Mattermost online status.

**Q69: How does the hybrid presence manager work?**
A: `OptimizedHybridPresenceManager` combines two data sources: (1) 3CX API — is the agent on a phone call? (2) Mattermost — is the agent online in chat? An agent is considered "available" only if they are both: not on a phone call (3CX) AND online in Mattermost. This gives the most accurate picture of real agent availability.

**Q70: How does the round-robin agent assignment work?**
A: `ConversationQueueService` maintains a pointer in Redis. When an escalation occurs: (1) read the pointer, (2) iterate from that position through the agent list, (3) find the first online/available agent, (4) assign the conversation, (5) increment the pointer. This distributes load evenly across agents. The pointer wraps around when it reaches the end.

**Q71: What email integration is used?**
A: AWS SES (Simple Email Service) via SMTP. `EmailService` sends emails for: appointment confirmations, escalation notifications, and manual sends from the dashboard. HTML templates are in `email_templates.py`. Configuration: SMTP server, port 587, TLS, AWS SES credentials.

**Q72: How does the prescription parser work?**
A: `PrescriptionParser` uses regex patterns to extract structured data from prescription text (parsed from uploaded images via OCR API). It extracts: patient name, medication, dosage, prescriber, date, and refills. `llamacloud_service.py` can also parse PDFs/images using LlamaCloud's AI-powered document parsing API.

**Q73: What is the CommonGateway API?**
A: An internal API at `apigateway.myonsitehealthcare.com` that validates whether a ZIP code is in the service area. The `ServiceAreaAgent` calls this API with the patient's ZIP code and returns whether mobile phlebotomy is available in that area.

**Q74: How are Twilio webhooks used?**
A: The `/api/webhooks/twilio/sms` and `/api/webhooks/twilio/voice` endpoints receive incoming SMS and voice call events from Twilio. These are currently basic webhook handlers — the full voice agent integration (inbound/outbound calls) is planned but not yet implemented (see docs/ for plans).

**Q75: What is the LIS Integration?**
A: LIS (Laboratory Information System) integration is documented in `docs/LIS_Integration_API_Specification.md`. It's the interface for sending lab orders and receiving results. The `orders.py` route has endpoints for validating requisitions and getting latest orders via an external API gateway.

### Security and Auth (Questions 76-85)

**Q76: How is HIPAA compliance addressed?**
A: (1) All data stays on self-hosted infrastructure (no third-party cloud for patient data). (2) MongoDB, Redis, and Mattermost are self-hosted. (3) Keycloak SSO with role-based access. (4) Only OpenAI API calls send conversation text externally (covered by OpenAI's BAA). (5) Security headers (HSTS, CSP, X-Frame-Options). (6) Input sanitization prevents injection attacks.

**Q77: How does the RBAC system work?**
A: Permissions are defined in `rbac_decorator.py`: view_conversations, manage_conversations, manage_agents, access_analytics, manage_users, manage_settings, system_administration, export_data, view_reports. Each role (admin, manager, agent) has default permissions. Decorators like `@require_permission("manage_users")` on API endpoints enforce these checks. Both frontend (route guards) and backend (decorators) enforce access control.

**Q78: How are passwords stored?**
A: `bcrypt` hashing via `passlib`. Passwords are never stored in plain text. `DashboardAuthService` uses `bcrypt.hash()` on registration and `bcrypt.verify()` on login. Keycloak manages its own password storage separately.

**Q79: How does rate limiting prevent abuse?**
A: Two layers: (1) `RateLimitMiddleware` — Redis-backed, per-IP, 200 requests/day and 50/hour for chat endpoints. Returns HTTP 429 when exceeded. (2) Per-session — 20 messages/minute (60 during appointment flow). In-memory timestamp list. This prevents both automated abuse and overly chatty users.

**Q80: What security headers are set?**
A: `SecurityHeadersMiddleware` adds: `X-Frame-Options: DENY` (prevent clickjacking), `X-Content-Type-Options: nosniff` (prevent MIME sniffing), `Strict-Transport-Security` (force HTTPS), `Content-Security-Policy` (restrict resource loading), `X-XSS-Protection` (browser XSS filter).

**Q81: How is input sanitized?**
A: `InputSanitizationMiddleware` strips HTML tags, script tags, SQL injection patterns, and XSS payloads from all incoming request data (body, query parameters, headers). This happens before any route handler processes the request.

**Q82: Why is the auth_middleware currently accepting any token?**
A: It's a development shortcut — the middleware returns a fixed test user for any token. This is marked as a TODO for production JWT validation. In production, the `dashboard_auth_middleware.py` handles real authentication via Keycloak session validation.

**Q83: How are API keys protected?**
A: API keys (OpenAI, Mattermost, 3CX, etc.) are stored in `.env` (gitignored) and injected as environment variables in Docker. They never appear in code, logs (the logging config masks sensitive values), or API responses. The `env.example` file documents required keys without actual values.

**Q84: How is CORS configured?**
A: The backend allows specific origins: the dashboard URL, the widget URL, and additional origins from `ADDITIONAL_CORS_ORIGINS`. Wildcard (`*`) is not used. Only listed origins can make cross-origin requests. WebSocket connections are also CORS-checked by Socket.IO.

**Q85: What happens if someone tries to inject malicious content in a chat message?**
A: Multiple layers: (1) `InputSanitizationMiddleware` strips dangerous content. (2) `EmojiCleaner` cleans AI responses. (3) The chat widget escapes HTML when rendering messages. (4) The LLM is prompted to ignore attempts to manipulate it (prompt injection defense in the system prompt).

### Performance and Monitoring (Questions 86-95)

**Q86: What is the average response time?**
A: Cache HIT: 1-3 seconds (fast model with cached context). Cache MISS: 5-10 seconds (thinking model with RAG). Greeting/simple: <1 second (no LLM call, fixed response). Tool calls add 1-2 seconds per tool. The main latency is the OpenAI API call.

**Q87: How is system health monitored?**
A: `GET /api/health` — basic health check. `GET /api/health/detailed` — checks MongoDB, Redis, ChromaDB connectivity. `GET /api/monitoring/health` — system metrics. `HealthCheckManager` runs periodic checks. The dashboard shows backend connection status. Mattermost has its own health endpoints.

**Q88: What happens during a traffic spike?**
A: Uvicorn's `limit_concurrency=200` caps concurrent requests. Excess requests get HTTP 503. Rate limiting per IP prevents abuse. The OpenAI API has its own rate limits (requests/min, tokens/min). If OpenAI rate-limits us, we return a retry message. There's no auto-scaling — the system has a fixed capacity.

**Q89: How is the conversation timeout service implemented?**
A: A background task runs every 60 seconds, queries MongoDB for conversations with no activity in the last 5 minutes, and updates their status to "complete". This prevents abandoned conversations from lingering in the "active" state.

**Q90: What logging is in place?**
A: Python's `logging` module with structured formatting. `clean_logging_config.py` suppresses noisy logs (SSL warnings, 3CX debug spam). Conversation events are logged by `ConversationLogger`. Logs go to stdout (captured by Docker) and optionally to files (via `chatbot-logs` volume).

**Q91: How would you add APM (Application Performance Monitoring)?**
A: Options: (1) LangSmith — already configured (LANGCHAIN_TRACING_V2 env var) for tracing LangGraph executions. (2) New Relic or Datadog — add their Python agent to requirements.txt and configure. (3) Prometheus + Grafana — export metrics from FastAPI middleware and create dashboards.

**Q92: How is the sentiment analysis done?**
A: `SentimentAnalysisService` uses TextBlob (rule-based) + keyword detection. TextBlob gives a polarity score (-1 to +1). Keywords like "frustrated", "angry", "confused" override TextBlob for more accurate detection. This runs in the `post_process_node` after every response. Results are stored in MongoDB and shown in dashboard analytics.

**Q93: What is the backlog of the server?**
A: Uvicorn is configured with `backlog=500` — this is the OS-level TCP connection queue. Up to 500 connections can wait for acceptance when all 200 concurrent slots are busy. Beyond that, connections are refused at the OS level.

**Q94: How is memory usage managed?**
A: The sentence-transformers model (all-MiniLM-L6-v2) loads into memory once (~80MB). PyTorch CPU runtime adds ~200MB. In-memory caches are capped: session locks at 10K (oldest evicted), message queue at 1000, rate limit store is per-session. Docker resource limits cap total memory per container.

**Q95: How can you profile the application?**
A: (1) Python's `cProfile` for function-level profiling. (2) `py-spy` for sampling profiler (no code changes needed). (3) FastAPI middleware to measure request duration. (4) LangSmith traces show time spent in each LangGraph node. (5) OpenAI response headers include token usage per request.

### Deployment and DevOps (Questions 96-105)

**Q96: How is the application deployed?**
A: `deploy.sh` runs `docker-compose up --build -d` with environment-specific `.env` files. The multi-stage Dockerfile builds both the dashboard (Node.js) and backend (Python) into a single image. Docker Compose orchestrates 4 services: backend, dashboard, Redis, ChromaDB. MongoDB is external.

**Q97: How do you do zero-downtime deployments?**
A: Currently, deployments have brief downtime during container restart. For zero-downtime: (1) Use blue-green deployment (run new version alongside old, switch traffic). (2) Use Docker's `--update-delay` with Swarm. (3) Use a load balancer that drains connections before switching. The chat widget's auto-reconnect handles brief disconnections gracefully.

**Q98: How are database migrations handled?**
A: Scripts in `scripts/` directory. `setup_databases.py` handles initial setup. `mongodb_migration.py` handles schema changes. There's no automated migration framework like Alembic (for SQL) — migrations are run manually. MongoDB's schema-less nature means most changes don't require migrations.

**Q99: How is the application backed up?**
A: `scripts/backup_database.py` creates MongoDB backups. Redis has AOF persistence (survives restarts) but no explicit backup script. ChromaDB data is in a Docker volume (`chroma-data`). No automated backup schedule is configured — backups are manual.

**Q100: How do you roll back a failed deployment?**
A: Docker images are tagged. Roll back by running `docker-compose up -d` with the previous image tag. MongoDB data is backward-compatible (schema-less). Redis data is transient (TTL-based). The main risk is LangGraph checkpoint format changes — if the graph structure changes, old checkpoints may not be compatible.

**Q101: What CI/CD pipeline exists?**
A: No CI/CD is currently configured. The deployment is manual via `deploy.sh`. To add CI/CD: GitHub Actions or GitLab CI running tests, building Docker images, pushing to a registry, and deploying via SSH or container orchestrator.

**Q102: How is environment configuration managed across dev/staging/prod?**
A: Separate `.env` files per environment. Docker Compose reads `.env` at the project root. Dashboard environment variables (VITE_*) are baked in at build time — separate builds are needed per environment. Backend variables are injected at container runtime.

**Q103: What monitoring alerts exist?**
A: None currently configured. The health endpoints exist but no alerting system (PagerDuty, Opsgenie, Slack alerts) is connected. To add: configure a monitoring tool to poll `/api/health/detailed` and alert on failures.

**Q104: How is the Docker image size optimized?**
A: Multi-stage build (Node.js build artifacts copied, Node.js not in final image). Python 3.11-slim base (not full Debian). PyTorch CPU-only (not the full GPU version). `.dockerignore` excludes node_modules, .git, test files. Final image is ~2-3GB primarily due to PyTorch and sentence-transformers.

**Q105: What is the disaster recovery plan?**
A: Currently, there is no formal DR plan. To create one: (1) Automated MongoDB backups to S3. (2) Redis AOF backups. (3) ChromaDB volume snapshots. (4) Docker image stored in registry. (5) Infrastructure-as-code (Terraform) for server provisioning. (6) Documented runbook for recovery steps. Recovery time depends on MongoDB restore speed (minutes for small datasets, hours for large).
