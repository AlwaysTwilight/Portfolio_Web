from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    MAX_BATCH_SIZE = 100

    def __init__(self) -> None:
        self._gemini_client = None
        self._local_model = None
        self._using_local = False

    # ── Gemini ──────────────────────────────────────────────────────────────

    def _get_gemini_client(self):  # type: ignore[return]
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY not configured.")
        if self._gemini_client is None:
            from google import genai  # type: ignore[import]
            self._gemini_client = genai.Client(api_key=settings.gemini_api_key)
        return self._gemini_client

    def _embed_batch_gemini(self, texts: list[str]) -> list[list[float]]:
        response = self._get_gemini_client().models.embed_content(
            model=settings.gemini_embedding_model,
            contents=texts,
            config={"output_dimensionality": settings.gemini_embedding_dim},
        )
        return [item.values for item in response.embeddings]

    # ── Local sentence-transformers ──────────────────────────────────────────

    def _get_local_model(self):
        if self._local_model is None:
            from sentence_transformers import SentenceTransformer  # type: ignore[import]
            model_name = getattr(settings, "fallback_embedding_model", None) or "BAAI/bge-base-en-v1.5"
            logger.info("Loading local embedding model: %s", model_name)
            self._local_model = SentenceTransformer(model_name)
            logger.info("Local embedding model loaded.")
        return self._local_model

    def _embed_batch_local(self, texts: list[str]) -> list[list[float]]:
        model = self._get_local_model()
        vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return [v.tolist() for v in vecs]

    # ── Public API ───────────────────────────────────────────────────────────

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        if self._using_local:
            return self._embed_batch_local(texts)
        try:
            return self._embed_batch_gemini(texts)
        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower() or "RESOURCE_EXHAUSTED" in msg:
                logger.warning("Gemini embedding quota hit — switching to local model for this session.")
                self._using_local = True
                return self._embed_batch_local(texts)
            raise

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings: list[list[float]] = []
        for start in range(0, len(texts), self.MAX_BATCH_SIZE):
            batch = texts[start: start + self.MAX_BATCH_SIZE]
            embeddings.extend(self._embed_batch(batch))
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        embeddings = self.embed_documents([text])
        if not embeddings:
            raise ValueError("Query embedding returned no vectors.")
        return embeddings[0]

    @property
    def active_backend(self) -> str:
        return "local_bge" if self._using_local else "gemini"


embedding_service = EmbeddingService()
