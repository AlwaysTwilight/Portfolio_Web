from __future__ import annotations

import re


HEADING_RE = re.compile(r"^#{1,6}\s+(.*)$", re.MULTILINE)
SECTION_HEADING_RE = re.compile(r"^##+\s+(.*)$", re.MULTILINE)
TECH_ROW_RE = re.compile(r"^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|", re.MULTILINE)


def _clean_line(text: str) -> str:
    cleaned = (text or "").strip().strip(" -*|")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _extract_title(markdown: str, fallback: str) -> str:
    match = HEADING_RE.search(markdown or "")
    if not match:
        return fallback
    title = _clean_line(match.group(1)).strip(" -")
    return title or fallback


def _extract_section_body(markdown: str, section_name: str) -> str:
    pattern = re.compile(rf"^##+\s+.*{re.escape(section_name)}.*$", re.IGNORECASE | re.MULTILINE)
    match = pattern.search(markdown or "")
    if not match:
        return ""
    start = match.end()
    next_heading = SECTION_HEADING_RE.search(markdown[start:])
    end = start + next_heading.start() if next_heading else len(markdown)
    return (markdown[start:end] or "").strip()


def _extract_summary(markdown: str) -> str:
    for section_name in ("What Does It Do?", "What Is This System?", "What Is This?", "Project Overview", "Overview"):
        body = _extract_section_body(markdown, section_name)
        if not body:
            continue
        lines = [
            _clean_line(line)
            for line in body.splitlines()
            if _clean_line(line) and not _clean_line(line).startswith("|")
        ]
        if not lines:
            continue
        sentence = " ".join(lines[:4])
        return sentence[:420]

    paragraphs = [
        _clean_line(part)
        for part in (markdown or "").split("\n\n")
        if _clean_line(part) and not _clean_line(part).startswith("#")
    ]
    if not paragraphs:
        return ""
    return " ".join(paragraphs[:2])[:420]


def _extract_tech_stack(markdown: str) -> list[str]:
    stack: list[str] = []
    for match in TECH_ROW_RE.finditer(markdown or ""):
        tech = _clean_line(match.group(1))
        if not tech:
            continue
        if tech.lower() not in {item.lower() for item in stack}:
            stack.append(tech)
        if len(stack) >= 14:
            break

    if stack:
        return stack

    # Fallback: try to parse "Tech Stack:" lines.
    for line in (markdown or "").splitlines():
        cleaned = _clean_line(line)
        if not cleaned:
            continue
        if cleaned.lower().startswith("tech stack:"):
            value = cleaned.split(":", 1)[1]
            for item in value.split(","):
                tech = _clean_line(item)
                if tech and tech.lower() not in {x.lower() for x in stack}:
                    stack.append(tech)
            break
    return stack[:14]


def extract_project_card(markdown: str, fallback_title: str) -> dict[str, object]:
    title = _extract_title(markdown, fallback_title)
    summary = _extract_summary(markdown)
    tech_stack = _extract_tech_stack(markdown)
    what_it_does = _extract_section_body(markdown, "What Does It Do?") or _extract_section_body(markdown, "What is this system?") or ""
    what_it_does_lines = [_clean_line(line) for line in (what_it_does or "").splitlines() if _clean_line(line)]
    # Keep only the most useful lines for the UI modal.
    what_it_does_lines = [line for line in what_it_does_lines if not line.startswith("|")][:10]
    return {
        "title": title,
        "summary": summary,
        "techStack": tech_stack,
        "whatItDoes": what_it_does_lines,
    }
