from __future__ import annotations

import json
import re
from typing import Any

from app.services.llm import llm_service


_FENCE_RE = re.compile(r"^```(?:json)?|```$", re.MULTILINE)
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = _FENCE_RE.sub("", text or "").strip()
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    match = _JSON_BLOCK_RE.search(text or "")
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return {}


def _as_str_list(value: Any, limit: int) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for entry in value:
        text = str(entry).strip()
        if text and text not in items:
            items.append(text)
    return items[:limit]


EXPERIENCE_PROMPT = """You are an expert resume writer. Rewrite the work experience below into polished, \
professional, achievement-oriented content for a portfolio website.

Company: {company}
Role: {role}
Dates: {date_range}
Raw notes from the user:
{notes}

Rules:
- Use strong action verbs. Quantify impact only when the notes support it; never invent metrics or facts.
- "items": short titles of the projects/workstreams owned (2-6 words each), max 6.
- "highlights": full achievement-bullet sentences, max 5.
- "summary": a one-to-two sentence overview of the role.
- Stay truthful to the notes; do not add employers, tools, or dates that are not implied.

Return ONLY valid JSON (no markdown, no prose) with exactly these keys:
{{"company": "", "role": "", "dateRange": "", "summary": "", "items": [], "highlights": []}}"""

PROJECT_PROMPT = """You are an expert technical writer. Rewrite the project below into a polished portfolio project card.

Title: {title}
Known tech stack: {tech_stack}
Raw notes from the user:
{notes}

Rules:
- "summary": 1-3 sentences describing what the project is and the value it delivers.
- "whatItDoes": concrete capability bullets, max 8.
- "techStack": clean list of technologies (merge what you infer from the notes with the known stack), max 14.
- Be truthful to the notes; do not invent features or technologies.

Return ONLY valid JSON (no markdown, no prose) with exactly these keys:
{{"title": "", "summary": "", "whatItDoes": [], "techStack": []}}"""

SKILLS_PROMPT = """You are an expert resume writer. Organize the raw skills below into clean, grouped categories \
for a portfolio website.

Raw skills/notes from the user:
{notes}

Rules:
- Group related skills under sensible category names (e.g., "Languages", "AI/ML", "Backend", "Cloud & DevOps").
- Keep individual skill names concise and canonical (e.g., "PostgreSQL" not "postgres db").
- Do not invent skills that are not present in the notes.

Return ONLY valid JSON (no markdown, no prose) with exactly this shape:
{{"skills": [{{"category": "", "items": []}}]}}"""

ABOUT_PROMPT = """You are an expert personal-brand copywriter. Rewrite the notes below into a polished \
first-person "About" paragraph for an AI/ML engineer's portfolio.

Raw notes from the user:
{notes}

Rules:
- 2-4 sentences, confident but not boastful, first person.
- Stay truthful to the notes; do not invent roles, employers, or achievements.

Return ONLY valid JSON (no markdown, no prose) with exactly this key:
{{"text": ""}}"""


class AiRewriteService:
    def rewrite(self, kind: str, fields: dict[str, Any], notes: str) -> tuple[dict[str, Any], str]:
        kind = (kind or "").strip().lower()
        fields = fields or {}
        notes = (notes or "").strip()
        if kind == "experience":
            return self._rewrite_experience(fields, notes)
        if kind == "project":
            return self._rewrite_project(fields, notes)
        if kind == "skills":
            return self._rewrite_skills(notes)
        if kind in {"about", "summary"}:
            return self._rewrite_about(notes)
        raise ValueError(f"Unsupported rewrite kind: {kind!r}")

    def _rewrite_experience(self, fields: dict[str, Any], notes: str) -> tuple[dict[str, Any], str]:
        company = str(fields.get("company") or "").strip()
        role = str(fields.get("role") or "").strip()
        date_range = str(fields.get("dateRange") or fields.get("date_range") or "").strip()
        prompt = EXPERIENCE_PROMPT.format(
            company=company or "(not provided)",
            role=role or "(not provided)",
            date_range=date_range or "(not provided)",
            notes=notes or "(none)",
        )
        answer, provider = llm_service.generate(prompt)
        data = _parse_json(answer)
        draft = {
            "company": str(data.get("company") or company).strip(),
            "role": str(data.get("role") or role).strip(),
            "dateRange": str(data.get("dateRange") or date_range).strip(),
            "summary": str(data.get("summary") or "").strip(),
            "items": _as_str_list(data.get("items"), 6),
            "highlights": _as_str_list(data.get("highlights"), 5),
        }
        return draft, provider

    def _rewrite_project(self, fields: dict[str, Any], notes: str) -> tuple[dict[str, Any], str]:
        title = str(fields.get("title") or "").strip()
        tech_stack_in = _as_str_list(fields.get("techStack") or fields.get("tech_stack"), 20)
        prompt = PROJECT_PROMPT.format(
            title=title or "(not provided)",
            tech_stack=", ".join(tech_stack_in) or "(none provided)",
            notes=notes or "(none)",
        )
        answer, provider = llm_service.generate(prompt)
        data = _parse_json(answer)
        draft = {
            "title": str(data.get("title") or title).strip(),
            "summary": str(data.get("summary") or "").strip(),
            "whatItDoes": _as_str_list(data.get("whatItDoes"), 8),
            "techStack": _as_str_list(data.get("techStack"), 14) or tech_stack_in,
        }
        return draft, provider

    def _rewrite_skills(self, notes: str) -> tuple[dict[str, Any], str]:
        prompt = SKILLS_PROMPT.format(notes=notes or "(none)")
        answer, provider = llm_service.generate(prompt)
        data = _parse_json(answer)
        categories: list[dict[str, Any]] = []
        for entry in data.get("skills") or []:
            if not isinstance(entry, dict):
                continue
            category = str(entry.get("category") or "").strip()
            items = _as_str_list(entry.get("items"), 20)
            if category and items:
                categories.append({"category": category, "items": items})
        return {"skills": categories}, provider

    def _rewrite_about(self, notes: str) -> tuple[dict[str, Any], str]:
        prompt = ABOUT_PROMPT.format(notes=notes or "(none)")
        answer, provider = llm_service.generate(prompt)
        data = _parse_json(answer)
        text = str(data.get("text") or "").strip()
        if not text:
            text = answer.strip()
        return {"text": text}, provider


ai_rewrite_service = AiRewriteService()
