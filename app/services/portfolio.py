from __future__ import annotations

import html
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.metadata import metadata_store
from app.services.vector_store import vector_store


DATE_RANGE_PATTERN = re.compile(
    r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\s*[\-–—]\s*(Present|Currently|Current|Now|Jan(?:uary)?\s+\d{4}|Feb(?:ruary)?\s+\d{4}|Mar(?:ch)?\s+\d{4}|Apr(?:il)?\s+\d{4}|May\s+\d{4}|Jun(?:e)?\s+\d{4}|Jul(?:y)?\s+\d{4}|Aug(?:ust)?\s+\d{4}|Sep(?:t|tember)?\s+\d{4}|Oct(?:ober)?\s+\d{4}|Nov(?:ember)?\s+\d{4}|Dec(?:ember)?\s+\d{4})",
    re.IGNORECASE,
)
HEADING_RE = re.compile(r"^#{1,6}\s+(.*)$", re.MULTILINE)
TECH_ROW_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|", re.MULTILINE)

PROJECT_OVERRIDES: dict[str, dict[str, Any]] = {
    "PROJECT_COMPLETE_GUIDE-e7nneq4d5tfsfrhmtm93r8ozdy.md": {
        "title": "Carevio AI Chatbot Platform",
        "summary": (
            "An enterprise customer-service chatbot platform for myOnsite Healthcare that combines a website widget, "
            "a FastAPI and LangGraph backend, real-time agent escalation, semantic retrieval, and an admin dashboard "
            "for monitoring live conversations."
        ),
        "techStack": [
            "FastAPI",
            "LangGraph",
            "React",
            "JavaScript Widget",
            "ChromaDB",
            "Redis",
            "MongoDB",
            "Docker Compose",
        ],
    },
    "SENTIMENT_ANALYSIS_DEEP_DIVE-i6jzqszoy7drpjqnwc9uu3synw.md": {
        "title": "Call Center Sentiment Analysis System",
        "summary": (
            "A production pipeline that ingests call recordings from 3CX via S3, transcribes them, performs sentiment "
            "analysis and summarization, stores structured results in MongoDB, and surfaces operational insights in a dashboard."
        ),
        "techStack": [
            "Next.js",
            "OpenAI Whisper",
            "GPT-4",
            "AWS S3",
            "MongoDB",
            "TypeScript",
            "3CX Integration",
        ],
    },
}


class PortfolioService:
    def __init__(self) -> None:
        self.project_files = [
            Path("PROJECT_COMPLETE_GUIDE-e7nneq4d5tfsfrhmtm93r8ozdy.md"),
            Path("SENTIMENT_ANALYSIS_DEEP_DIVE-i6jzqszoy7drpjqnwc9uu3synw.md"),
        ]

    def _normalize_text(self, text: str) -> str:
        replacements = {
            "\ufeff": "",
            "â€”": " - ",
            "â€“": "-",
            "â€": '"',
            "â€™": "'",
            "â€˜": "'",
            "â€œ": '"',
            "â€": '"',
            "â†’": "->",
            "â€¢": "- ",
            "â”€": "-",
            "â”‚": "|",
            "â”œ": "|-",
            "â””": "\\-",
            "â†“": "v",
            "&#x26;": "&",
        }
        normalized = html.unescape(text)
        for source, target in replacements.items():
            normalized = normalized.replace(source, target)
        normalized = normalized.replace("\r\n", "\n")
        normalized = re.sub(r"[ \t]+", " ", normalized)
        normalized = re.sub(r"\n{3,}", "\n\n", normalized)
        return normalized.strip()

    def _clean_line(self, text: str) -> str:
        cleaned = self._normalize_text(text).strip(" -*|")
        cleaned = re.sub(r"\s+", " ", cleaned)
        return cleaned.strip()

    def _read_markdown(self, path: Path) -> str:
        return self._normalize_text(path.read_text(encoding="utf-8", errors="ignore"))

    def _extract_section_body(self, text: str, section_name: str) -> str:
        pattern = re.compile(rf"^##+\s+.*{re.escape(section_name)}.*$", re.IGNORECASE | re.MULTILINE)
        match = pattern.search(text)
        if not match:
            return ""
        start = match.end()
        next_heading = re.search(r"^##\s+", text[start:], re.MULTILINE)
        end = start + next_heading.start() if next_heading else len(text)
        return text[start:end].strip()

    def _extract_project_summary(self, text: str) -> str:
        for section_name in ("What Does It Do?", "What Is This System?", "What Is This?", "Project Overview"):
            body = self._extract_section_body(text, section_name)
            if not body:
                continue
            lines = [
                self._clean_line(line)
                for line in body.splitlines()
                if self._clean_line(line) and not self._clean_line(line).startswith("|")
            ]
            if not lines:
                continue
            sentence = " ".join(lines[:4])
            return sentence[:420]
        paragraphs = [
            self._clean_line(line)
            for line in text.splitlines()
            if self._clean_line(line) and not line.lstrip().startswith("#")
        ]
        return " ".join(paragraphs[:3])[:420]

    def _extract_tech_stack(self, text: str) -> list[str]:
        stack: list[str] = []
        tech_body = self._extract_section_body(text, "Tech Stack") or self._extract_section_body(
            text, "Tech Stack - What We Use and Why"
        )
        source = tech_body or text
        for choice, _why in TECH_ROW_RE.findall(source):
            cleaned = self._clean_line(choice)
            if not cleaned:
                continue
            cleaned = cleaned.replace("Choice", "").strip()
            if cleaned.lower() not in {item.lower() for item in stack}:
                stack.append(cleaned)
            if len(stack) >= 10:
                break
        return stack

    def _extract_title(self, text: str, fallback: str) -> str:
        match = HEADING_RE.search(text)
        if not match:
            return fallback
        title = self._clean_line(match.group(1)).strip(" -")
        return title or fallback

    def _project_payload(self, path: Path) -> dict[str, Any]:
        override = PROJECT_OVERRIDES.get(path.name)
        text = self._read_markdown(path)
        title = override["title"] if override else self._extract_title(text, path.stem)
        summary = override["summary"] if override else self._extract_project_summary(text)
        tech_stack = override["techStack"] if override else self._extract_tech_stack(text)
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        return {
            "id": slug,
            "title": title,
            "summary": summary,
            "techStack": tech_stack,
            "sourcePath": str(path.resolve()),
        }

    def _get_resume_chunks(self) -> list[dict[str, Any]]:
        documents = metadata_store.list_documents()
        resume_doc = next((doc for doc in documents if doc["logical_document_key"].lower() == "resume"), None)
        if not resume_doc or not resume_doc.get("active_version_id"):
            return []
        result = vector_store.get_active_document_chunks(
            settings.chroma_collection_name,
            resume_doc["logical_document_key"],
            resume_doc["active_version_id"],
        )
        chunks = []
        for chunk_id, document, metadata in zip(result.get("ids", []), result.get("documents", []), result.get("metadatas", [])):
            chunks.append({"id": chunk_id, "document": self._normalize_text(document), "metadata": metadata})
        return sorted(chunks, key=lambda item: int(item["metadata"].get("chunk_index", 0)))

    def _extract_header(self, chunks: list[dict[str, Any]]) -> dict[str, str]:
        if not chunks:
            return {"name": "Raj Sahoo", "location": "India", "headline": "AI/ML Software Developer"}
        first = chunks[0]
        name = self._clean_line(str(first["metadata"].get("section_title") or "Raj Sahoo"))
        lines = [self._clean_line(line) for line in str(first["document"]).splitlines() if self._clean_line(line) and not line.startswith("#")]
        location = "India"
        if lines:
            parts = [part.strip() for part in lines[0].split("|") if part.strip()]
            if parts:
                location = parts[-1]
        return {
            "name": name,
            "location": location,
            "headline": "AI/ML Software Developer building production AI systems, automation pipelines, and intelligent products.",
        }

    def _extract_experience(self, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        grouped: dict[str, dict[str, Any]] = defaultdict(lambda: {"items": [], "highlights": [], "dateRange": ""})
        for chunk in chunks:
            metadata = chunk["metadata"]
            section_path = str(metadata.get("section_path") or "")
            if not section_path.startswith("Experience >"):
                continue
            company = self._clean_line(str(metadata.get("section_title") or "Experience"))
            entry = grouped[company]
            entry["company"] = company
            text = str(chunk["document"]).translate(str.maketrans({"–": "-", "—": "-", "−": "-"}))
            if not entry["dateRange"]:
                match = DATE_RANGE_PATTERN.search(text)
                if match:
                    entry["dateRange"] = self._clean_line(match.group(0))
            for line in text.splitlines():
                cleaned = self._clean_line(line)
                if not cleaned or cleaned.startswith("#"):
                    continue
                if ":" in cleaned and len(cleaned.split(":", 1)[0]) < 90:
                    title = cleaned.split(":", 1)[0].strip()
                    if len(title) > 3 and title not in entry["items"]:
                        entry["items"].append(title)
                    continue
                if cleaned[0].islower() or len(cleaned) < 28:
                    continue
                if cleaned not in entry["highlights"]:
                    entry["highlights"].append(cleaned)
        return list(grouped.values())

    def _extract_skills(self, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for chunk in chunks:
            metadata = chunk["metadata"]
            if str(metadata.get("section_title") or "").lower() != "technical skills":
                continue
            categories: list[dict[str, Any]] = []
            for line in str(chunk["document"]).splitlines():
                cleaned = self._clean_line(line)
                if ":" not in cleaned:
                    continue
                category, values = cleaned.split(":", 1)
                items = [self._clean_line(item) for item in values.split(",") if self._clean_line(item)]
                categories.append({"category": category.strip(), "items": items})
            return categories
        return []

    def _extract_resume_projects(self, chunks: list[dict[str, Any]]) -> list[str]:
        project_names: list[str] = []
        for chunk in chunks:
            section_path = str(chunk["metadata"].get("section_path") or "")
            if not section_path.startswith("Projects"):
                continue
            title = self._clean_line(str(chunk["metadata"].get("section_title") or ""))
            if title and title.lower() != "projects" and title not in project_names:
                project_names.append(title)
        return project_names[:8]

    def get_portfolio_payload(self) -> dict[str, Any]:
        chunks = self._get_resume_chunks()
        header = self._extract_header(chunks)
        experience = self._extract_experience(chunks)
        skills = self._extract_skills(chunks)
        resume_projects = self._extract_resume_projects(chunks)
        about = (
            "I build production AI systems, real-time automation, retrieval pipelines, and applied ML products. "
            "My recent work spans conversational AI, intelligent dashboards, sentiment analysis, enterprise integrations, and agentic workflows."
        )
        manual_projects = metadata_store.list_portfolio_projects()
        projects = manual_projects

        # Backwards-compatible seed content for fresh installs (or before any admin-added projects exist).
        if not projects:
            projects = [self._project_payload(path) for path in self.project_files if path.exists()]

        # If a project is present in the Resume "Projects" section but doesn't have a project card yet,
        # surface it as a placeholder so it's visible on the portfolio and can be upgraded via an upload.
        seen_titles = {str(item.get("title") or "").strip().lower() for item in projects}
        for title in resume_projects:
            key = title.strip().lower()
            if not key or key in seen_titles:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-") or key.replace(" ", "-")
            projects.append(
                {
                    "id": slug,
                    "title": title.strip(),
                    "summary": "Upload this project's document in Admin to generate a full summary and details.",
                    "techStack": [],
                    "sourcePath": "Resume",
                }
            )
            seen_titles.add(key)
        return {
            "profile": {
                **header,
                "about": about,
                "openToWork": metadata_store.get_open_to_work(),
                "currentLocation": metadata_store.get_current_location(),
                "desiredLocations": metadata_store.get_desired_locations(),
                "experience": experience,
                "skills": skills,
                "resumeProjects": resume_projects,
            },
            "projects": projects,
            "documents": metadata_store.list_documents(),
        }


portfolio_service = PortfolioService()
