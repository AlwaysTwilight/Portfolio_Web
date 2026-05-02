from __future__ import annotations

from google import genai

from app.config import settings


class EmbeddingService:
    MAX_BATCH_SIZE = 100

    def __init__(self) -> None:
        self._gemini_client: genai.Client | None = None

    def _get_gemini_client(self) -> genai.Client:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is not configured.")
        if self._gemini_client is None:
            self._gemini_client = genai.Client(api_key=settings.gemini_api_key)
        return self._gemini_client

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        response = self._get_gemini_client().models.embed_content(
            model=settings.gemini_embedding_model,
            contents=texts,
            config={"output_dimensionality": settings.gemini_embedding_dim},
        )
        return [item.values for item in response.embeddings]

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        embeddings: list[list[float]] = []
        for start in range(0, len(texts), self.MAX_BATCH_SIZE):
            batch = texts[start : start + self.MAX_BATCH_SIZE]
            embeddings.extend(self._embed_batch(batch))
        return embeddings

    def embed_query(self, text: str) -> list[float]:
        embeddings = self.embed_documents([text])
        if not embeddings:
            raise ValueError("Query embedding returned no vectors.")
        return embeddings[0]


embedding_service = EmbeddingService()
