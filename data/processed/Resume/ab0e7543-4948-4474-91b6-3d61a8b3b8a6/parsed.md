
Raj Sahoo
+91-9004736269 | alwaystwilight109@gmail.com | LinkedIn | Github | Mumbai, Maharashtra

# Education

| Parul University                | Vadodara, Gujarat |
| ------------------------------- | ----------------- |
| B.Tech – Information Technology | 2021 – 2025       |
| • CGPA: 7.67/10.0               |                   |

# Experience

# AI/ML Software Developer

Dec 2024 – Present

MyOnsite Healthcare, Vadodara

- Carevio – Production AI Chatbot: Architected and deployed a full-stack, HIPAA-aligned customer service chatbot serving a nationwide mobile phlebotomy company across all 50 US states. Built a stateful LangGraph conversation engine with conditional branching and tool-calling loops, backed by ChromaDB (RAG), Redis, and MongoDB.
- Implemented a semantic QA cache layer using SentenceTransformers with cosine similarity search to reduce repetitive OpenAI calls by serving cached answers – cutting average response latency from 5–10s to 1–3s on cache hits.
- Engineered smart model routing to dynamically dispatch between gpt-4o-mini (fast path) and o3-mini (reasoning path) based on query complexity, and built a real-time admin dashboard for live conversation monitoring and human agent escalation.
- Dockerized and deployed backend (FastAPI + Uvicorn), dashboard, Redis, and ChromaDB via Docker Compose on AWS EC2; system handles appointment scheduling, insurance queries, and emergency routing with full conversation logging to MongoDB.
- Voice AI Agent – Realtime Telephony System: Built a production voice AI agent using GPT-4o Realtime API for low-latency conversational handling of inbound customer support calls – capable of validating orders, scheduling/rescheduling/cancelling appointments, and checking appointment status by querying live databases.
- Integrated OpenAI Whisper for speech transcription, ElevenLabs for high-quality voice synthesis, and LangGraph for stateful multi-turn conversation orchestration; used Redis for session management and MongoDB for durable conversation storage.
- Implemented intelligent call routing logic to transfer calls to human agents when the AI detects out-of-scope queries or explicit escalation requests; deployed on AWS EC2 with Lambda triggers for scalable call ingestion.
- Sentiment Analysis Dashboard: Built an end-to-end automated pipeline processing call recordings from AWS S3 – transcribing audio via OpenAI Whisper and classifying sentiment, extracting keywords, and generating summaries via GPT-4 in a single API call; stored results in MongoDB.
- Provided a dashboard with per-agent performance tables, AI-generated daily intelligence reports.
- CRM MCP Server: Designed and deployed a production MCP (Model Context Protocol) server bridging AI assistants (Cursor IDE, Claude Desktop) to a CRM database; enforced SELECT-only query execution with bcrypt-authenticated access, enabling non-technical team members to query CRM data in plain English.
- Built multi-tenant architecture allowing redeployment for additional databases via single config change; Dockerized with systemd auto-start and deployed to production.
- AI Proctoring System: Designed a real-time proctoring microservice using YOLOv8n to detect prohibited objects (cell phones, laptops, books) from COCO classes with a 2-second continuous visibility threshold to eliminate false positives, and MediaPipe Face Mesh (468 facial landmarks) for head-turn detection via eye-ear angle averaging – flagging sustained turns beyond 45◦ for 5 seconds with a 3-warnings-to-1-violation escalation; added a separate MediaPipe Face Detection model for multi-candidate monitoring, independently tracking no-face and multiple-face scenarios using frame-rate-independent wall-clock thresholds.
- Lead Qualification Middleware: Engineered a vector-database (ChromaDB) + KNN classifier pipeline using OpenAI embeddings and NLP to automatically segregate genuine leads from junk at the ingestion layer.
- Social Media Automation: Built n8n workflow integrating Perplexity AI for content research, WordPress for publishing, and Freepik/Nano Banana APIs for image generation, auto-posting to LinkedIn, Twitter, and Instagram.

# Projects

- Multimodal Image Captioning System | Python, TensorFlow, CNN, LSTM, Attention Mechanisms
- Built and trained a supervised CNN-LSTM model with attention mechanisms from scratch on a Kaggle dataset; evaluated caption quality using BLEU, METEOR, and CIDEr metrics.
- Real-Time Sign Language Recognition System | Python, OpenCV, TensorFlow, MediaPipe
- Collected and labeled a custom ASL dataset with data augmentation; trained a CNN from scratch and integrated MediaPipe hand landmark detection with OpenCV for real-time low-latency inference.



# Employee Promotion Prediction Engine

Python, Scikit-learn, XGBoost, FastAPI

- Led a team of 4 to build an HR analytics solution using ensemble methods (Logistic Regression, Random Forest, XGBoost) with SHAP-based interpretability; deployed with a FastAPI backend and interactive dashboard for HR teams

# Plant Disease Classification System

Python, TensorFlow, Keras, OpenCV, scikit-image, Pandas, Seaborn

- Built and trained a custom 3-block CNN from scratch on 87,000+ leaf images across 38 disease categories (14 plant species), achieving 96.57% validation accuracy in 10 epochs using TensorFlow/Keras Sequential API with progressive filter scaling (32 → 64 → 128), dual Dropout regularization (0.2 + 0.5), and Adam + categorical crossentropy
- Engineered a memory-efficient data pipeline using ImageDataGenerator.flow from directory with pixel normalization, 256×256 resizing, and batch loading (batch size 32) to handle 70K training images without loading the full dataset into RAM
- Evaluated with per-class classification report and 38×38 seaborn confusion matrix; macro-average precision, recall, and F1 all at 96% across all disease categories on a 17,572-image held-out validation set

# Technical Skills

- LLM &#x26; Agentic AI: LangGraph, LangChain, RAG, LLMs, Prompt Engineering, MCP Servers
- Vector &#x26; Search: ChromaDB, Sentence Transformers, Embeddings, KNN Similarity Search
- Machine Learning &#x26; Computer Vision: Python, NLP, TensorFlow, Scikit-learn, Pandas, NumPy, OpenCV, CNN, LSTM, YOLO, MediaPipe, XGBoost, Hugging Face, Feature Engineering
- Backend &#x26; APIs: FastAPI, Flask, REST APIs, Socket.IO, WebSockets, Docker, Git, GitLab, n8n Automation
- Databases &#x26; Infrastructure: MongoDB, Redis, ChromaDB, MySQL, PostgreSQL, AWS (EC2, S3, Lambda, RDS, CloudWatch)

# Accomplishments &#x26; Leadership

- AI/ML Hackathon 2024 – Participated in Parul University’s AI/ML hackathon conducted by myOnsite Healthcare
- Shaastra Programming Contest 2023 – Competed at IIT Madras in national-level algorithmic programming competition
- Technical Mentorship – Served as judge and mentor at an AI/ML hackathon organized by myOnsite Healthcare; assessed project implementations and scored teams on technical execution and innovation
- Team Leadership – Currently mentoring and overseeing 10 interns building enterprise-grade AI/ML systems; conducting code reviews, establishing standards, and running knowledge transfer sessions
- Production Impact – Systems in active production: Carevio chatbot, Voice AI agent, CRM MCP server, sentiment analysis dashboard, and AI proctoring platform handling real customer traffic across multiple departments