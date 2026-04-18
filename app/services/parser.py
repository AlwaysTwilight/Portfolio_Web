from __future__ import annotations

from pathlib import Path

from llama_parse import LlamaParse

from app.config import settings


PLAIN_TEXT_EXTENSIONS = {'.txt', '.md', '.markdown'}


class DocumentParser:
    def __init__(self) -> None:
        self._parser: LlamaParse | None = None

    def _get_parser(self) -> LlamaParse:
        if not settings.llama_cloud_api_key:
            raise ValueError("LLAMA_CLOUD_API_KEY is not configured.")
        if self._parser is None:
            self._parser = LlamaParse(
                api_key=settings.llama_cloud_api_key,
                result_type="markdown",
                verbose=False,
            )
        return self._parser

    def _parse_plain_text(self, file_path: Path) -> str:
        for encoding in ('utf-8', 'utf-8-sig', 'latin-1'):
            try:
                text = file_path.read_text(encoding=encoding)
                if text.strip():
                    return text
            except UnicodeDecodeError:
                continue
        raise ValueError(f"Could not decode text from {file_path.name}")

    def parse(self, file_path: Path) -> str:
        if file_path.suffix.lower() in PLAIN_TEXT_EXTENSIONS:
            text = self._parse_plain_text(file_path)
            if not text.strip():
                raise ValueError(f"No text extracted from {file_path.name}")
            return text

        parser = self._get_parser()
        documents = parser.load_data(str(file_path))
        text = "\n\n".join(doc.text for doc in documents if getattr(doc, "text", "").strip())
        if not text.strip():
            raise ValueError(f"No text extracted from {file_path.name}")
        return text


document_parser = DocumentParser()
