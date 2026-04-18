from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from app.config import settings


@dataclass
class Chunk:
    text: str
    section_title: str
    section_path: list[str]
    semantic_type: str
    chunk_index_within_section: int

    def metadata(self) -> dict[str, object]:
        section_path_text = " > ".join(self.section_path)
        section_role = classify_section_role(self.section_path, self.semantic_type)
        entities = extract_entities(self.text, self.section_path)
        return {
            "section_title": self.section_title,
            "section_path": section_path_text,
            "semantic_type": self.semantic_type,
            "chunk_index_within_section": self.chunk_index_within_section,
            "chunk_char_count": len(self.text),
            "parent_section": self.section_path[-2] if len(self.section_path) > 1 else "",
            "section_depth": len(self.section_path),
            "section_role": section_role,
            "entity_people": " | ".join(entities["people"]),
            "entity_organizations": " | ".join(entities["organizations"]),
            "entity_work_items": " | ".join(entities["work_items"]),
            "entity_topics": " | ".join(entities["topics"]),
        }


@dataclass
class SemanticBlock:
    text: str
    section_path: list[str]
    semantic_type: str


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
BULLET_RE = re.compile(r"^(\-|\*|\u2022|\d+\.)\s+")
TABLE_RE = re.compile(r"^\|.*\|$")
PLAIN_HEADING_RE = re.compile(r"^[A-Z][A-Za-z0-9/&(),:+\-\s]{2,100}$")
BULLET_TITLE_RE = re.compile(r"^[\-\*\u2022\d.\s]+([^:\n]{3,120}):", re.MULTILINE)
PROPER_NOUN_RE = re.compile(r"\b([A-Z][A-Za-z0-9&/+-]*(?:\s+[A-Z][A-Za-z0-9&/+-]*){0,5})\b")
TOP_LEVEL_TITLES = {
    "summary", "profile", "education", "experience", "projects", "technical skills", "skills",
    "accomplishments leadership", "accomplishments", "leadership", "certifications", "publications",
    "awards", "work experience", "professional experience", "overview", "introduction", "background",
    "architecture", "implementation", "setup", "configuration", "usage", "api", "faq",
}
CHILD_FRIENDLY_PARENTS = {
    "experience", "projects", "work experience", "professional experience", "architecture",
    "implementation", "setup", "configuration", "usage", "api", "faq",
}
ORG_HINTS = {"inc", "llc", "ltd", "limited", "corp", "corporation", "company", "healthcare", "technologies", "systems", "labs", "solutions", "university"}
ROLE_HINTS = {"experience", "work experience", "professional experience", "employment", "career"}
PROJECT_HINTS = {"projects", "case studies", "initiatives", "engagements", "products"}
SKILL_HINTS = {"skills", "technical skills", "competencies", "expertise"}


def _normalize_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized


def _normalize_heading_title(title: str) -> str:
    lowered = title.lower().replace("&", " ")
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def classify_section_role(section_path: list[str], semantic_type: str) -> str:
    joined = " ".join(_normalize_heading_title(part) for part in section_path if part)
    last = _normalize_heading_title(section_path[-1]) if section_path else ""
    if any(hint in joined for hint in ROLE_HINTS):
        return "experience_section"
    if any(hint in joined for hint in PROJECT_HINTS):
        return "project_section"
    if any(hint in joined for hint in SKILL_HINTS):
        return "skills_section"
    if semantic_type == "bullet_group" and last and any(token in last for token in ORG_HINTS):
        return "organization_section"
    if len(section_path) == 1 and last and re.fullmatch(r"[A-Z][A-Za-z .'-]{2,80}", section_path[0]):
        return "profile_section"
    return "general_section"


def _unique_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def extract_entities(text: str, section_path: list[str]) -> dict[str, list[str]]:
    candidate_titles = [match.group(1).strip() for match in BULLET_TITLE_RE.finditer(text)]
    proper_nouns = [match.group(1).strip() for match in PROPER_NOUN_RE.finditer("\n".join(section_path + [text]))]
    people = [item for item in proper_nouns if re.fullmatch(r"[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}", item)]
    organizations = [
        item for item in proper_nouns
        if any(hint in item.lower().split() for hint in ORG_HINTS) or any(hint in item.lower() for hint in ORG_HINTS)
    ]
    work_items = [item for item in candidate_titles if len(item.split()) <= 12]
    topics = [item for item in proper_nouns if item not in people and item not in organizations and item not in work_items]
    if section_path:
        last = section_path[-1].strip()
        if any(hint in last.lower() for hint in ORG_HINTS):
            organizations.insert(0, last)
        elif len(section_path) > 1 and any(hint in section_path[-2].lower() for hint in ROLE_HINTS):
            organizations.insert(0, last)
        elif any(hint in last.lower() for hint in PROJECT_HINTS):
            topics.insert(0, last)
    return {
        "people": _unique_keep_order(people),
        "organizations": _unique_keep_order(organizations),
        "work_items": _unique_keep_order(work_items),
        "topics": _unique_keep_order(topics),
    }


def _last_top_level_parent(heading_stack: list[tuple[int, str]]) -> tuple[int, str] | None:
    for level, title in reversed(heading_stack):
        if level == 1 and _normalize_heading_title(title) in CHILD_FRIENDLY_PARENTS:
            return level, title
    return None


def _infer_heading_level(base_level: int, title: str, heading_stack: list[tuple[int, str]]) -> int:
    normalized = _normalize_heading_title(title)
    if normalized in TOP_LEVEL_TITLES:
        return 1
    if not heading_stack:
        return 1
    child_parent = _last_top_level_parent(heading_stack)
    if base_level == 1 and child_parent is not None:
        return 2
    if base_level > heading_stack[-1][0]:
        return heading_stack[-1][0] + 1
    return base_level


def _push_heading(title: str, heading_stack: list[tuple[int, str]], base_level: int = 1) -> None:
    level = _infer_heading_level(base_level, title, heading_stack)
    while heading_stack and heading_stack[-1][0] >= level:
        heading_stack.pop()
    heading_stack.append((level, title))


def _flush_buffer(blocks: list[SemanticBlock], buffer: list[str], section_path: list[str], semantic_type: str) -> None:
    if not buffer:
        return
    blocks.append(SemanticBlock(text="\n".join(buffer).strip(), section_path=section_path.copy(), semantic_type=semantic_type))
    buffer.clear()


def _parse_semantic_blocks(text: str) -> list[SemanticBlock]:
    blocks: list[SemanticBlock] = []
    heading_stack: list[tuple[int, str]] = []
    buffer: list[str] = []
    buffer_kind = "paragraph"
    pending_plain_heading: str | None = None

    def current_section_path() -> list[str]:
        return [title for _level, title in heading_stack]

    for raw_line in text.split("\n"):
        stripped = raw_line.strip()
        if not stripped:
            _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)
            buffer_kind = "paragraph"
            continue

        heading_match = HEADING_RE.match(stripped)
        if heading_match:
            _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)
            _push_heading(heading_match.group(2).strip(), heading_stack, len(heading_match.group(1)))
            buffer_kind = "paragraph"
            pending_plain_heading = None
            continue

        if pending_plain_heading and stripped == pending_plain_heading:
            pending_plain_heading = None
            continue

        if pending_plain_heading:
            _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)
            _push_heading(pending_plain_heading, heading_stack, 1)
            buffer_kind = "paragraph"
            pending_plain_heading = None

        if PLAIN_HEADING_RE.match(stripped) and not BULLET_RE.match(stripped) and not TABLE_RE.match(stripped) and len(stripped.split()) <= 12:
            pending_plain_heading = stripped
            continue

        semantic_type = "paragraph"
        if BULLET_RE.match(stripped):
            semantic_type = "bullet_group"
        elif TABLE_RE.match(stripped):
            semantic_type = "table"

        if buffer and semantic_type != buffer_kind:
            _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)

        buffer_kind = semantic_type
        buffer.append(stripped)

    if pending_plain_heading:
        _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)
        _push_heading(pending_plain_heading, heading_stack, 1)
    _flush_buffer(blocks, buffer, current_section_path(), buffer_kind)
    return [block for block in blocks if block.text]


def _prefix_for_section(section_path: list[str]) -> str:
    if not section_path:
        return ""
    return "\n".join(f"# {title}" for title in section_path) + "\n\n"


def _split_large_block(block: SemanticBlock) -> list[Chunk]:
    chunks: list[Chunk] = []
    prefix = _prefix_for_section(block.section_path)
    available_size = max(250, settings.chunk_size - len(prefix))
    body = block.text.strip()
    start = 0
    local_index = 0
    while start < len(body):
        end = min(start + available_size, len(body))
        if end < len(body):
            split_at = max(body.rfind("\n", start, end), body.rfind(". ", start, end))
            if split_at > start + 200:
                end = split_at + (0 if body[split_at:split_at + 1] == "\n" else 1)
        chunk_body = body[start:end].strip()
        if chunk_body:
            chunks.append(Chunk(text=f"{prefix}{chunk_body}".strip(), section_title=block.section_path[-1] if block.section_path else "Document", section_path=block.section_path.copy(), semantic_type=block.semantic_type, chunk_index_within_section=local_index))
            local_index += 1
        if end >= len(body):
            break
        start = max(0, end - settings.chunk_overlap)
    return chunks


def chunk_text(text: str) -> list[Chunk]:
    normalized = _normalize_text(text)
    if not normalized:
        return []
    blocks = _parse_semantic_blocks(normalized)
    chunks: list[Chunk] = []
    current_text = ""
    current_section_path: list[str] = []
    current_semantic_type = "paragraph"
    section_counters: dict[str, int] = {}

    def flush_current() -> None:
        nonlocal current_text, current_section_path, current_semantic_type
        if not current_text.strip():
            current_text = ""
            current_section_path = []
            current_semantic_type = "paragraph"
            return
        merged_block = SemanticBlock(text=current_text.strip(), section_path=current_section_path.copy(), semantic_type=current_semantic_type)
        if len(merged_block.text) > settings.chunk_size:
            chunks.extend(_split_large_block(merged_block))
        else:
            section_key = " > ".join(current_section_path) or "Document"
            local_index = section_counters.get(section_key, 0)
            chunks.append(Chunk(text=merged_block.text, section_title=current_section_path[-1] if current_section_path else "Document", section_path=current_section_path.copy(), semantic_type=current_semantic_type, chunk_index_within_section=local_index))
            section_counters[section_key] = local_index + 1
        current_text = ""
        current_section_path = []
        current_semantic_type = "paragraph"

    for block in blocks:
        prefix = _prefix_for_section(block.section_path)
        block_text = f"{prefix}{block.text}".strip() if block.section_path else block.text
        candidate = block_text if not current_text else f"{current_text}\n\n{block.text}"
        same_section = block.section_path == current_section_path
        if current_text and (not same_section or len(candidate) > settings.chunk_size):
            flush_current()
        if not current_text:
            current_text = block_text
            current_section_path = block.section_path.copy()
            current_semantic_type = block.semantic_type
        else:
            current_text = f"{current_text}\n\n{block.text}"
    flush_current()

    normalized_chunks: list[Chunk] = []
    section_counters.clear()
    for chunk in chunks:
        section_key = " > ".join(chunk.section_path) or "Document"
        local_index = section_counters.get(section_key, 0)
        chunk.chunk_index_within_section = local_index
        section_counters[section_key] = local_index + 1
        normalized_chunks.append(chunk)
    return normalized_chunks


def chunk_debug_payload(text: str) -> list[dict[str, object]]:
    return [asdict(chunk) for chunk in chunk_text(text)]
