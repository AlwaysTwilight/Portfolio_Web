from __future__ import annotations

from groq import Groq
from google import genai
from openai import OpenAI

from app.config import settings


class LLMService:
    def __init__(self) -> None:
        self._groq_client: Groq | None = None
        self._openrouter_client: OpenAI | None = None
        self._gemini_client: genai.Client | None = None

    def _get_groq_client(self) -> Groq:
        if not settings.groq_api_key:
            raise ValueError('GROQ_API_KEY is not configured.')
        if self._groq_client is None:
            self._groq_client = Groq(api_key=settings.groq_api_key)
        return self._groq_client

    def _get_openrouter_client(self) -> OpenAI:
        if not settings.openrouter_api_key:
            raise ValueError('OPENROUTER_API_KEY is not configured.')
        if self._openrouter_client is None:
            self._openrouter_client = OpenAI(api_key=settings.openrouter_api_key, base_url='https://openrouter.ai/api/v1')
        return self._openrouter_client

    def _get_gemini_client(self) -> genai.Client:
        if not settings.gemini_api_key:
            raise ValueError('GEMINI_API_KEY is not configured.')
        if self._gemini_client is None:
            self._gemini_client = genai.Client(api_key=settings.gemini_api_key)
        return self._gemini_client

    def _generate_groq(self, prompt: str) -> tuple[str, str]:
        completion = self._get_groq_client().chat.completions.create(
            model=settings.groq_chat_model,
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.2,
            max_completion_tokens=1024,
            top_p=1,
            stream=False,
        )
        answer = completion.choices[0].message.content or ''
        if not answer:
            raise ValueError('Groq returned an empty response.')
        return answer, f'groq:{settings.groq_chat_model}'

    def _generate_openrouter(self, prompt: str) -> tuple[str, str]:
        completion = self._get_openrouter_client().chat.completions.create(
            model=settings.openrouter_chat_model,
            messages=[{'role': 'user', 'content': prompt}],
            temperature=0.2,
            max_tokens=1024,
        )
        answer = completion.choices[0].message.content or ''
        if not answer:
            raise ValueError('OpenRouter returned an empty response.')
        return answer, f'openrouter:{settings.openrouter_chat_model}'

    def _generate_gemini(self, prompt: str) -> tuple[str, str]:
        response = self._get_gemini_client().models.generate_content(model=settings.gemini_chat_model, contents=prompt)
        answer = getattr(response, 'text', '')
        if not answer:
            raise ValueError('Gemini returned an empty response.')
        return answer, f'gemini:{settings.gemini_chat_model}'

    def generate(self, prompt: str) -> tuple[str, str]:
        errors: list[str] = []
        for generator in (self._generate_groq, self._generate_openrouter, self._generate_gemini):
            try:
                return generator(prompt)
            except Exception as exc:  # noqa: BLE001
                errors.append(str(exc))
        raise RuntimeError('All LLM providers failed: ' + ' | '.join(errors))


llm_service = LLMService()
