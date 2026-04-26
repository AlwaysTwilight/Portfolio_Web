from __future__ import annotations

import re
from datetime import datetime, timezone

from app.config import settings
from app.models import ChatResponse, ConversationTurn, SourceItem
from app.services.llm import llm_service
from app.services.metadata import metadata_store
from app.services.simple_retriever import simple_retriever


PROMPT_TEMPLATE = """You are Raj's portfolio assistant for a private document collection.

Answer using only the supplied Context. Do not use outside knowledge.

Rules:
- Treat named initiatives/systems/products/workstreams listed under an organization in Experience as valid answers for \"what did Raj work on\" at that org.
- Do not mix standalone Projects with Experience work items unless the context explicitly links them.
- Prefer concise, direct answers that preserve dates, role names, employers, metrics, and technologies.
- If the context is insufficient, say you do not know based on the uploaded files, EXCPET for availability/location questions which you should answer using the context below.

Availability & Location Context (Always True):
{availability_context}

Derived hints:
{derived_hints}

{conversation_history_section}Context:
{context}

Current question:
{question}
"""

MONTHS = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
    'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9, 'oct': 10,
    'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
}

STOP_WORDS = {
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'does', 'for', 'from', 'has', 'have', 'he', 'how',
    'in', 'is', 'it', 'of', 'on', 'or', 'she', 'tell', 'that', 'the', 'their', 'there', 'they', 'this',
    'to', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'about', 'me', 'please', 'did', 'work', 'worked'
}

GREETING_RE = re.compile(r'^\s*(hi|hello|hey|yo|hola|good morning|good afternoon|good evening)\b[!. ]*$', re.IGNORECASE)
SELF_QUESTION_RE = re.compile(
    r"^\s*(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|help|what\s+is\s+this|what\s+do\s+you\s+do)\b",
    re.IGNORECASE,
)
THANKS_RE = re.compile(r'^\s*(thanks|thank you|thx)\b[!. ]*$', re.IGNORECASE)
BYE_RE = re.compile(r'^\s*(bye|goodbye|see you|see ya)\b[!. ]*$', re.IGNORECASE)
OFF_TOPIC_RE = re.compile(
    r"\b(weather|forecast|temperature|rain|humidity|wind|sunrise|sunset|news|headlines|sports|score|stock|price of|bitcoin|crypto|movie times)\b",
    re.IGNORECASE,
)
DATE_RANGE_PATTERN = re.compile(
    r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\s*-\s*(Present|Currently|Current|Now|Jan(?:uary)?\s+\d{4}|Feb(?:ruary)?\s+\d{4}|Mar(?:ch)?\s+\d{4}|Apr(?:il)?\s+\d{4}|May\s+\d{4}|Jun(?:e)?\s+\d{4}|Jul(?:y)?\s+\d{4}|Aug(?:ust)?\s+\d{4}|Sep(?:t|tember)?\s+\d{4}|Oct(?:ober)?\s+\d{4}|Nov(?:ember)?\s+\d{4}|Dec(?:ember)?\s+\d{4})",
    re.IGNORECASE,
)
ITEM_TITLE_RE = re.compile(r'[-\u2022]\s+([^:\n]{3,120}):')
ORG_AFTER_PREP_RE = re.compile(r'\b(?:at|for|with)\s+([a-z0-9&.,()\-\s]{2,80})', re.IGNORECASE)
ORG_STOP_WORDS = {'that', 'this', 'company', 'organization', 'him', 'her', 'them', 'projects', 'work', 'worked', 'did', 'do'}


class ChatService:
    def _is_greeting(self, message: str) -> bool:
        return bool(GREETING_RE.match(message))

    def _is_self_question(self, message: str) -> bool:
        return bool(SELF_QUESTION_RE.match(message))

    def _is_thanks(self, message: str) -> bool:
        return bool(THANKS_RE.match(message))

    def _is_bye(self, message: str) -> bool:
        return bool(BYE_RE.match(message))

    def _is_off_topic(self, message: str) -> bool:
        lowered = message.lower()
        if "raj" in lowered or "portfolio" in lowered:
            return False
        return bool(OFF_TOPIC_RE.search(message))

    def _split_entities(self, value: object) -> list[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [item.strip() for item in value.split(' | ') if item.strip()]
        return []

    def _parse_month_year(self, value: str, today: datetime) -> tuple[int, int]:
        lowered = value.strip().lower()
        if lowered in {'present', 'currently', 'current', 'now'}:
            return today.year, today.month
        month_name, year = lowered.split()
        return int(year), MONTHS[month_name]

    def _build_derived_hints(self, message: str, documents: list[str]) -> str:
        lowered_message = message.lower()
        if not any(keyword in lowered_message for keyword in ['experience', 'year', 'years', 'month', 'months']):
            return 'No extra derived hints.'
        today = datetime.now(timezone.utc)
        spans: list[tuple[tuple[int, int], tuple[int, int], str]] = []
        for document in documents:
            normalized_document = document.translate(str.maketrans({'\u2013': '-', '\u2014': '-', '\u2212': '-'}))
            for match in DATE_RANGE_PATTERN.finditer(normalized_document):
                start_month = match.group(1)
                start_year = match.group(2)
                end_value = match.group(3)
                start = (int(start_year), MONTHS[start_month.lower()])
                end = self._parse_month_year(end_value, today)
                spans.append((start, end, match.group(0)))
        if not spans:
            return 'No extra derived hints.'
        total_months = sum(((end[0] - start[0]) * 12 + (end[1] - start[1]) + 1) for start, end, _ in spans)
        years = total_months // 12
        months = total_months % 12
        span_labels = ', '.join(label for *_rest, label in spans)
        return (
            f'Derived from explicit date ranges in context: {span_labels}. '
            f'As of {today.date().isoformat()}, the approximate experience duration is {years} years and {months} months. '
            'Use this only if the question is asking for duration or experience based on those dates.'
        )

    def _query_terms(self, message: str) -> set[str]:
        return {token for token in re.findall(r'[a-z0-9]+', message.lower()) if len(token) > 2 and token not in STOP_WORDS}

    def _extract_query_organization(self, message: str) -> str | None:
        lowered = message.lower()
        for org in ('myonsite healthcare', 'carevio'):
            if org in lowered:
                return org
        match = ORG_AFTER_PREP_RE.search(lowered)
        if not match:
            return None
        phrase = re.split(r'[?.,;]|\b(?:and|but|who|what|which|where|when)\b', match.group(1), maxsplit=1)[0].strip()
        tokens = [token for token in re.findall(r'[a-z0-9&.-]+', phrase) if token not in ORG_STOP_WORDS]
        if not tokens:
            return None
        return ' '.join(tokens[:4])

    def _query_intent(self, message: str) -> dict[str, object]:
        lowered = message.lower()
        return {
            'organization': self._extract_query_organization(message),
            'wants_work_items': (
                ('work on' in lowered) or
                ('worked on' in lowered) or
                ('what did' in lowered and ('company' in lowered or 'organization' in lowered or ' at ' in lowered)) or
                ('projects' in lowered and ('company' in lowered or 'experience' in lowered or 'worked' in lowered or 'that company' in lowered))
            ),
            'wants_experience': 'experience' in lowered,
        }

    def _entity_overlap(self, query_terms: set[str], metadata: dict[str, object]) -> float:
        score = 0.0
        for field, weight in (
            ('entity_people', 1.2),
            ('entity_organizations', 2.0),
            ('entity_work_items', 1.6),
            ('entity_topics', 1.0),
        ):
            values = ' '.join(self._split_entities(metadata.get(field))).lower()
            score += sum(weight for term in query_terms if term in values)
        return score

    def _rerank_score(self, message: str, document: str, metadata: dict[str, object], distance: float | None) -> float:
        terms = self._query_terms(message)
        intent = self._query_intent(message)
        haystacks = [
            document.lower(),
            str(metadata.get('section_title') or '').lower(),
            str(metadata.get('section_path') or '').lower(),
            str(metadata.get('parent_section') or '').lower(),
        ]
        combined = ' \n '.join(haystacks)
        overlap = sum(1 for term in terms if term in combined)
        title_boost = sum(2 for term in terms if term in str(metadata.get('section_title') or '').lower())
        path_boost = sum(1.5 for term in terms if term in str(metadata.get('section_path') or '').lower())
        parent_boost = sum(1.5 for term in terms if term in str(metadata.get('parent_section') or '').lower())
        entity_boost = self._entity_overlap(terms, metadata)
        semantic_type = metadata.get('semantic_type')
        section_role = str(metadata.get('section_role') or '')
        semantic_boost = 0.3 if semantic_type in {'bullet_group', 'table'} else 0.1 if semantic_type == 'paragraph' else -0.2
        if intent['wants_work_items'] and section_role in {'experience_section', 'organization_section'}:
            semantic_boost += 3.0
        if intent['wants_work_items'] and section_role == 'project_section':
            semantic_boost -= 1.8
        organization = str(intent['organization'] or '').lower()
        if organization:
            org_values = ' '.join(self._split_entities(metadata.get('entity_organizations'))).lower()
            section_value = str(metadata.get('section_path') or '').lower()
            if organization in org_values or organization in section_value:
                semantic_boost += 4.0
        current_role_boost = 0.8 if any(term in {'current', 'experience', 'work'} for term in terms) and 'present' in document.lower() else 0.0
        return overlap + title_boost + path_boost + parent_boost + entity_boost + semantic_boost + current_role_boost - float(distance or 0.0)

    def _expand_context(self, ranked_hits: list[dict[str, object]]) -> list[dict[str, object]]:
        return sorted(ranked_hits, key=lambda item: int(item['metadata'].get('chunk_index', 0)))

    def _augment_with_profile_context(self, message: str, hits: list[dict[str, object]]) -> list[dict[str, object]]:
        return hits

    def _focus_section_key(self, message: str, hits: list[dict[str, object]]) -> tuple[str | None, str | None]:
        intent = self._query_intent(message)
        organization = str(intent['organization'] or '').lower()
        if organization:
            for hit in hits:
                metadata = hit['metadata']
                section_path = str(metadata.get('section_path') or '')
                entity_orgs = ' '.join(self._split_entities(metadata.get('entity_organizations'))).lower()
                if organization in section_path.lower() or organization in entity_orgs:
                    return section_path, str(metadata.get('section_title') or '')
        for hit in hits:
            metadata = hit['metadata']
            if str(metadata.get('section_role') or '') in {'experience_section', 'organization_section'}:
                return str(metadata.get('section_path') or ''), str(metadata.get('section_title') or '')
        return None, None

    def _filter_hits_for_intent(self, message: str, hits: list[dict[str, object]]) -> tuple[list[dict[str, object]], str | None]:
        intent = self._query_intent(message)
        if not hits or not intent['wants_work_items']:
            return hits, None
        focus_section, focus_title = self._focus_section_key(message, hits)
        if focus_section:
            filtered = [hit for hit in hits if str(hit['metadata'].get('section_path') or '') == focus_section]
            if filtered:
                return filtered, focus_title
        company_section_hits = [
            hit for hit in hits
            if str(hit['metadata'].get('section_role') or '') in {'experience_section', 'organization_section'}
        ]
        if company_section_hits:
            return company_section_hits, str(company_section_hits[0]['metadata'].get('section_title') or '')
        return hits, None

    def _merge_hits_for_prompt(self, hits: list[dict[str, object]]) -> list[dict[str, object]]:
        merged: list[dict[str, object]] = []
        for hit in hits:
            metadata = hit['metadata']
            key = str(metadata.get('section_path') or metadata.get('section_title') or metadata.get('chunk_index'))
            if merged and merged[-1]['merge_key'] == key:
                merged[-1]['document'] = f"{merged[-1]['document']}\n\n{hit['document']}"
                merged[-1]['chunk_indices'].append(int(metadata.get('chunk_index', 0)))
                merged[-1]['score'] = max(float(merged[-1]['score']), float(hit.get('score', 0.0)))
            else:
                merged.append(
                    {
                        'merge_key': key,
                        'document': str(hit['document']),
                        'metadata': metadata,
                        'distance': hit.get('distance'),
                        'score': hit.get('score', 0.0),
                        'chunk_indices': [int(metadata.get('chunk_index', 0))],
                    }
                )
        return merged

    def _retrieve_context(self, message: str) -> tuple[list[dict[str, object]], list[dict[str, object]], str, str | None]:
        initial_k = max(settings.top_k * 4, 10)
        results = simple_retriever.search(message, initial_k)
        hits: list[dict[str, object]] = []
        for result in results:
            chunk_id = str(result.get('id') or '')
            document = str(result.get('document') or '')
            metadata = result.get('metadata') if isinstance(result.get('metadata'), dict) else {}
            score = float(result.get('score') or 0.0) + self._rerank_score(message, document, metadata, None)
            hits.append({'id': chunk_id, 'document': document, 'metadata': metadata, 'distance': None, 'score': score})
        ranked = sorted(hits, key=lambda item: item['score'], reverse=True)
        expanded = self._expand_context(ranked)
        augmented = self._augment_with_profile_context(message, expanded)
        filtered, focus_title = self._filter_hits_for_intent(message, augmented)
        selected = sorted(filtered, key=lambda item: (-float(item.get('score', 0.0)), float(item.get('distance') or 0.0)))[: settings.top_k + 5]
        merged = self._merge_hits_for_prompt(sorted(selected, key=lambda item: int(item['metadata'].get('chunk_index', 0))))
        return merged, ranked[: settings.top_k], 'simple_bm25', focus_title

    def _build_work_item_answer(self, message: str, focus_title: str | None, selected_hits: list[dict[str, object]]) -> str | None:
        intent = self._query_intent(message)
        if not intent['wants_work_items']:
            return None
        work_items: list[str] = []
        for hit in selected_hits:
            metadata = hit['metadata']
            for item in self._split_entities(metadata.get('entity_work_items')):
                if item and item not in work_items:
                    work_items.append(item)
            for item in ITEM_TITLE_RE.findall(str(hit['document'])):
                cleaned = item.strip()
                if cleaned and cleaned not in work_items:
                    work_items.append(cleaned)
        if not work_items:
            return None
        org_label = focus_title or intent['organization']
        if org_label:
            intro = f"Based on the uploaded files, the work at {org_label} includes"
        else:
            intro = "Based on the uploaded files, the relevant work items include"
        if len(work_items) == 1:
            return f"{intro} {work_items[0]}."
        return f"{intro} " + ', '.join(work_items[:-1]) + f", and {work_items[-1]}."

    def _is_referential_query(self, message: str) -> bool:
        """Detect short follow-up questions that rely on pronouns or implicit references."""
        lowered = message.lower().strip()
        referential_patterns = [
            r'^(tell me more|more details?|elaborate|explain( more)?)[.!?]*$',
            r'^(what (is|are|was|were) (it|that|this|they|them|those|these))[.!?]*$',
            r'^(tell me more about (it|that|this|them|those|these))[.!?]*$',
            r'^(how (does|did|do) (it|that|this|they|them) work)[.!?]*$',
            r'^(can you (explain|describe|elaborate|tell me more))[.!?]*$',
            r'^(and (what|how|why|when|where|who|tell me))',
            r'^(more about (it|that|this))',
        ]
        return any(re.search(pattern, lowered) for pattern in referential_patterns)

    def _expand_query_with_history(self, message: str, history: list[ConversationTurn]) -> str:
        """For short referential queries, prepend the last assistant reply as context."""
        if not history or not self._is_referential_query(message):
            return message
        # Find the last assistant message to use as context for the referential query
        last_assistant = next(
            (turn.content for turn in reversed(history) if turn.role == 'assistant'),
            None,
        )
        if not last_assistant:
            return message
        # Construct an expanded, self-contained query
        excerpt = last_assistant[:300].rstrip()
        return f"{message} (Context from previous answer: {excerpt})"

    def _build_conversation_history_section(self, history: list[ConversationTurn]) -> str:
        """Render the last 6 conversation turns as a formatted section for the prompt."""
        recent = history[-6:] if len(history) > 6 else history
        if not recent:
            return ''
        lines = ['Conversation history (most recent turns):',
                 '---']
        for turn in recent:
            role_label = 'User' if turn.role == 'user' else 'Assistant'
            lines.append(f"{role_label}: {turn.content}")
        lines.append('---\n')
        return '\n'.join(lines) + '\n'

    def answer(
        self,
        message: str,
        include_debug: bool = False,
        history: list[ConversationTurn] | None = None,
        active_project_title: str | None = None,
    ) -> ChatResponse:
        history = history or []
        normalized_message = message.strip()
        if self._is_greeting(normalized_message):
            return ChatResponse(
                answer='Hi! Ask me anything about the files you uploaded, and I will answer from that document context.',
                sources=[],
                debug=[{'intent': 'greeting'}] if include_debug else None,
            )
        if self._is_self_question(normalized_message):
            return ChatResponse(
                answer=(
                    "I'm Raj's portfolio assistant. I can answer questions about Raj's projects, experience, and AI systems work "
                    "based on the documents you uploaded."
                ),
                sources=[],
                debug=[{'intent': 'assistant_identity'}] if include_debug else None,
            )
        if self._is_thanks(normalized_message):
            return ChatResponse(
                answer="You're welcome. Ask me anything about Raj's work or the uploaded documents.",
                sources=[],
                debug=[{'intent': 'thanks'}] if include_debug else None,
            )
        if self._is_bye(normalized_message):
            return ChatResponse(
                answer="Bye. If you come back, ask me about Raj's projects or experience and I'll answer from the uploaded files.",
                sources=[],
                debug=[{'intent': 'bye'}] if include_debug else None,
            )
        if self._is_off_topic(normalized_message):
            return ChatResponse(
                answer="I can only help with questions about Raj's portfolio and the uploaded documents (not general topics like weather).",
                sources=[],
                debug=[{'intent': 'off_topic'}] if include_debug else None,
            )

        # For referential/follow-up queries, expand the query with prior context before retrieval.
        retrieval_query = self._expand_query_with_history(normalized_message, history)
        if active_project_title and active_project_title.strip():
            # Keep this short to avoid token bloat, but still bias retrieval toward the viewed project.
            retrieval_query = f"{retrieval_query} (Project focus: {active_project_title.strip()})"

        selected_hits, ranked_hits, retrieval_backend, focus_title = self._retrieve_context(retrieval_query)
        if not selected_hits:
            debug = [{'retrieval_backend': retrieval_backend}] if include_debug else []
            return ChatResponse(
                answer='I do not know based on the uploaded files.',
                sources=[],
                debug=debug if include_debug else None,
            )

        context_parts: list[str] = []
        sources: list[SourceItem] = []
        debug: list[dict[str, object]] = []
        for index, hit in enumerate(selected_hits):
            document = str(hit['document'])
            metadata = hit['metadata']
            section_path = metadata.get('section_path') or None
            if section_path:
                context_parts.append(f"[Source {index + 1} | Section: {section_path}]\n{document}")
            else:
                context_parts.append(f"[Source {index + 1}] {document}")
            sources.append(
                SourceItem(
                    logical_document_key=metadata['logical_document_key'],
                    version_id=metadata['version_id'],
                    file_name=metadata['file_name'],
                    source_label=metadata.get('source_label') or None,
                    section_title=metadata.get('section_title') or None,
                    section_path=section_path,
                    semantic_type=metadata.get('semantic_type') or None,
                    chunk_index=min(hit.get('chunk_indices', [int(metadata['chunk_index'])])),
                    snippet=document[:280],
                )
            )
        if include_debug:
            debug.append({'retrieval_backend': retrieval_backend})
            debug.append({'retrieval_query': retrieval_query})
            debug.append({'query_intent': self._query_intent(retrieval_query)})
            debug.append({'focus_title': focus_title})
            for index, hit in enumerate(ranked_hits):
                debug.append({'rank': index + 1, 'distance': hit['distance'], 'score': hit['score'], 'metadata': hit['metadata']})

        work_item_answer = self._build_work_item_answer(retrieval_query, focus_title, selected_hits)
        if work_item_answer:
            if include_debug:
                debug.append({'answer_strategy': 'work_item_extraction'})
            return ChatResponse(answer=work_item_answer, sources=sources, debug=debug if include_debug else None)

        conversation_history_section = self._build_conversation_history_section(history)
        
        open_to_work = metadata_store.get_open_to_work()
        current_loc = metadata_store.get_current_location()
        desired_loc = metadata_store.get_desired_locations()
        avail_ctx = f"Raj is {'open to new work opportunities' if open_to_work else 'currently not looking for roles'}. "
        avail_ctx += f"Current location: {current_loc}. "
        if desired_loc:
            avail_ctx += f"Desired locations for work: {', '.join(desired_loc)}."

        prompt = PROMPT_TEMPLATE.format(
            context='\n\n'.join(context_parts),
            question=normalized_message,
            today=datetime.now(timezone.utc).date().isoformat(),
            availability_context=avail_ctx,
            derived_hints=self._build_derived_hints(retrieval_query, [str(hit['document']) for hit in selected_hits]),
            conversation_history_section=conversation_history_section,
        )
        answer, provider = llm_service.generate(prompt)
        if include_debug:
            debug.append({'llm_provider': provider})
        return ChatResponse(answer=answer, sources=sources, debug=debug if include_debug else None)


chat_service = ChatService()
