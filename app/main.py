from __future__ import annotations

import html
import re
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.config import settings
from app.models import ChatRequest, ChatResponse, DocumentSummary, DocumentVersion, HealthResponse, IngestRequest, UploadResponse
from app.services.ai_rewrite import ai_rewrite_service
from app.services.chat import chat_service
from app.services.email import email_service
from app.services.ingestion import ingestion_service
from app.services.metadata import metadata_store
from app.services.portfolio import portfolio_service
from app.services.project_cards import extract_project_card
from app.services.storage import ensure_storage_dirs, save_upload
from app.services.vector_store import vector_store


app = FastAPI(title="Local RAG Backend", version="0.1.0")

cors_origins = (
    settings.cors_allow_origins
    if settings.cors_allow_origins
    else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8501",
        "http://127.0.0.1:8501",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=settings.cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UpdateSettingsRequest(BaseModel):
    open_to_work: bool
    current_location: str
    desired_locations: list[str]
    name: str | None = None
    location: str | None = None
    headline: str | None = None
    about: str | None = None
    eyebrow: str | None = None
    experience: list[dict] = []
    skills: list[dict] = []


class SocialLinksRequest(BaseModel):
    linkedin: str = ""
    github: str = ""
    email: str = ""


class ContactRequest(BaseModel):
    name: str
    email: str
    message: str
    source: str = "form"


class SchedulingRequest(BaseModel):
    calLink: str = ""
    enabled: bool = False
    headline: str = "Let's talk"
    subtext: str = ""


class SectionsRequest(BaseModel):
    sections: list[dict] = []


class ReviewRequest(BaseModel):
    name: str
    position: str
    review_text: str
    company: str = ""
    rating: int = 0
    linkedin_url: str = ""
    endorsed_skills: list[str] = []
    # Honeypot — real users leave this empty; bots tend to fill every field.
    website: str = ""


class GuestbookRequest(BaseModel):
    name: str
    note: str
    color: str = ""
    website: str = ""


class EventRequest(BaseModel):
    event_type: str
    target: str = ""


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_contact(name: str, email: str, message: str) -> tuple[str, str, str]:
    name = (name or "").strip()
    email = (email or "").strip()
    message = (message or "").strip()
    if not name or len(name) > 120:
        raise HTTPException(status_code=422, detail="Please provide a valid name.")
    if not email or not _EMAIL_RE.match(email) or len(email) > 200:
        raise HTTPException(status_code=422, detail="Please provide a valid email address.")
    if len(message) < 2 or len(message) > 4000:
        raise HTTPException(status_code=422, detail="Message must be between 2 and 4000 characters.")
    return name, email, message


def _valid_skill_names() -> set[str]:
    """Skill names currently on the public portfolio — used to validate that
    endorsed skills actually correspond to real page skills."""
    names: set[str] = set()
    try:
        payload = portfolio_service.get_portfolio_payload()
        for group in payload.get("skills", []) or []:
            for item in group.get("items", []) or []:
                cleaned = str(item).strip()
                if cleaned:
                    names.add(cleaned.lower())
    except Exception:
        pass
    return names


class RewriteRequest(BaseModel):
    kind: str
    fields: dict = {}
    notes: str = ""


class UpsertProjectRequest(BaseModel):
    title: str
    summary: str
    tech_stack: list[str] = []
    source_path: str = "Admin"
    sort_order: int = 0
    what_it_does: list[str] = []
    is_visible: bool = True
    source_logical_document_key: str | None = None
    source_version_id: str | None = None


def _require_admin(x_admin_token: str | None) -> None:
    # If ADMIN_TOKEN is unset, keep local dev friction-free.
    if not settings.admin_token:
        return
    # Constant-time comparison — a plain `!=` leaks timing information an
    # attacker could use to guess the token one character at a time.
    if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Rate limiting ─────────────────────────────────────────────────────────────
# A simple in-memory sliding window per (bucket, client IP). It resets on
# restart and isn't shared across worker processes — not a substitute for a
# real gateway limiter — but it stops naive scripted spam/cost-abuse on the
# public write endpoints (chat, contact, reviews, guestbook, upload) without
# adding new infrastructure for a single-instance personal site.
_rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def _rate_limit(request: Request, bucket: str, limit: int, window_seconds: float) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{client_ip}"
    now = time.monotonic()
    bucket_q = _rate_buckets[key]
    while bucket_q and now - bucket_q[0] > window_seconds:
        bucket_q.popleft()
    if len(bucket_q) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests — please slow down and try again shortly.")
    bucket_q.append(now)


def _backfill_active_versions() -> None:
    documents = metadata_store.list_documents()
    if not any(item.get('active_version_id') for item in documents):
        return
    needs_backfill = False
    try:
        primary_count = vector_store.count(settings.chroma_collection_name)
        needs_backfill = primary_count == 0 and any(item.get('active_version_id') for item in documents)
    except Exception:
        needs_backfill = any(item.get('active_version_id') for item in documents)

    if not needs_backfill:
        return

    for document in documents:
        active_version_id = document.get('active_version_id')
        if not active_version_id:
            continue
        versions = document.get('versions', [])
        active_version = next((version for version in versions if version.get('version_id') == active_version_id), None)
        if not active_version or active_version.get('status') not in {'indexed', 'embedding', 'indexing'}:
            continue
        try:
            ingestion_service.ingest(active_version_id)
        except Exception:
            continue


@app.on_event("startup")
def on_startup() -> None:
    ensure_storage_dirs()
    metadata_store.initialize()
    _backfill_active_versions()


@app.get("/")
def root() -> dict:
    return {"message": "API running"}


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get('/portfolio')
def portfolio() -> dict:
    return portfolio_service.get_portfolio_payload()


@app.get('/scheduling')
def get_scheduling() -> dict:
    getter = getattr(metadata_store, "get_scheduling", None)
    return getter() if callable(getter) else {"calLink": "", "enabled": False, "headline": "Let's talk", "subtext": ""}


@app.post('/contact')
def submit_contact(request: ContactRequest, http_req: Request) -> dict:
    _rate_limit(http_req, "contact", limit=5, window_seconds=300)
    name, email, message = _validate_contact(request.name, request.email, request.message)
    source = "chat" if request.source == "chat" else "form"
    creator = getattr(metadata_store, "create_contact_message", None)
    stored = creator(name, email, message, source) if callable(creator) else None
    delivery = email_service.send_contact_notification(name, email, message, source)
    return {
        "ok": True,
        "stored": bool(stored),
        "emailed": bool(delivery.get("sent")),
    }


# ── Reviews / testimonials ──────────────────────────────────────────────────

def _moderation_page(title: str, message: str, confirm_action: tuple[str, str, str] | None = None) -> HTMLResponse:
    # `title`/`message` are only ever built from hardcoded strings + values
    # already run through html.escape() by the caller — never raw user input.
    site = settings.public_site_url
    confirm_html = ""
    if confirm_action:
        endpoint, token, action = confirm_action
        confirm_html = f"""
    <form method="post" action="{endpoint}">
      <input type="hidden" name="token" value="{html.escape(token)}">
      <input type="hidden" name="action" value="{html.escape(action)}">
      <button type="submit" style="display:inline-block;padding:10px 22px;background:{'#16a34a' if action == 'approve' else '#dc2626'};color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
        Confirm {'approve' if action == 'approve' else 'reject'}
      </button>
    </form>"""
    html_body = f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b12;color:#e8e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
  <div style="text-align:center;max-width:460px;padding:40px 28px;background:#15151f;border:1px solid #2a2a3a;border-radius:16px;">
    <div style="font-size:44px;margin-bottom:12px;">{title.split(' ')[0]}</div>
    <h1 style="font-size:20px;margin:0 0 8px;">{title}</h1>
    <p style="color:#9a9ab0;font-size:14px;line-height:1.6;margin:0 0 24px;">{message}</p>
    {confirm_html}
    <div style="margin-top:16px;"><a href="{site}" style="display:inline-block;padding:10px 22px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Go to portfolio</a></div>
  </div>
</body></html>"""
    return HTMLResponse(content=html_body)


@app.post("/reviews")
def submit_review(request: ReviewRequest, http_req: Request) -> dict:
    _rate_limit(http_req, "reviews", limit=5, window_seconds=600)
    # Honeypot: silently accept but drop bot submissions.
    if request.website.strip():
        return {"ok": True, "stored": False}

    name = (request.name or "").strip()
    position = (request.position or "").strip()
    text = (request.review_text or "").strip()
    company = (request.company or "").strip()
    linkedin = (request.linkedin_url or "").strip()

    if not name or len(name) > 120:
        raise HTTPException(status_code=422, detail="Please provide your name.")
    if not position or len(position) > 120:
        raise HTTPException(status_code=422, detail="Please provide your role / position.")
    if len(text) < 10 or len(text) > 2000:
        raise HTTPException(status_code=422, detail="Review must be between 10 and 2000 characters.")
    if len(company) > 120:
        raise HTTPException(status_code=422, detail="Company name is too long.")
    if linkedin and not linkedin.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="LinkedIn URL must start with http(s)://")

    rating = int(request.rating or 0)
    if rating < 0 or rating > 5:
        rating = 0

    valid = _valid_skill_names()
    endorsed = [s.strip() for s in (request.endorsed_skills or []) if s.strip()]
    # Keep only endorsements that map to real page skills (case-insensitive).
    if valid:
        endorsed = [s for s in endorsed if s.lower() in valid][:12]
    else:
        endorsed = endorsed[:12]

    creator = getattr(metadata_store, "create_review", None)
    if not callable(creator):
        raise HTTPException(status_code=503, detail="Reviews are not available.")
    review = creator(
        name=name, position=position, review_text=text, company=company,
        rating=rating, linkedin_url=linkedin, endorsed_skills=endorsed,
    )
    delivery = email_service.send_review_notification(review)
    return {"ok": True, "stored": True, "emailed": bool(delivery.get("sent"))}


@app.get("/reviews")
def list_public_reviews() -> dict:
    lister = getattr(metadata_store, "list_approved_reviews", None)
    reviews = lister(limit=100) if callable(lister) else []
    # Strip nothing sensitive is stored, but never expose tokens (not selected anyway).
    counts_getter = getattr(metadata_store, "get_skill_endorsement_counts", None)
    endorsements = counts_getter() if callable(counts_getter) else {}
    return {"reviews": reviews, "endorsements": endorsements}


@app.get("/reviews/moderate")
def moderate_review_confirm_page(token: str, action: str) -> HTMLResponse:
    # GET only ever shows a confirmation page and never changes anything — a
    # GET that approves/rejects on load can get auto-triggered by email
    # clients' "safe link" prefetch scanners before a human ever clicks it.
    if action not in {"approve", "reject"}:
        return _moderation_page("⚠️ Unknown action", "Use the buttons in the notification email.")
    getter = getattr(metadata_store, "get_review_by_token", None)
    review = getter(token) if callable(getter) else None
    if not review:
        return _moderation_page("⚠️ Link expired", "This review could not be found. It may have already been handled.")
    name = html.escape(str(review.get("name") or "This"))
    return _moderation_page(
        f"Confirm: {'publish' if action == 'approve' else 'reject'} review",
        f"{name}'s review — click below to {'publish it' if action == 'approve' else 'reject and hide it'}.",
        confirm_action=("/reviews/moderate", token, action),
    )


@app.post("/reviews/moderate")
def moderate_review_confirm(token: str = Form(...), action: str = Form(...)) -> HTMLResponse:
    getter = getattr(metadata_store, "get_review_by_token", None)
    review = getter(token) if callable(getter) else None
    if not review:
        return _moderation_page("⚠️ Link expired", "This review could not be found. It may have already been handled.")
    setter = getattr(metadata_store, "set_review_status", None)
    if not callable(setter):
        return _moderation_page("⚠️ Unavailable", "Reviews cannot be moderated right now.")
    name = html.escape(str(review.get("name") or "This"))
    if action == "approve":
        setter(review["review_id"], "approved")
        return _moderation_page("✅ Review published", f"{name}'s review is now live on your portfolio.")
    if action == "reject":
        setter(review["review_id"], "rejected")
        return _moderation_page("🚫 Review rejected", f"{name}'s review has been hidden and will not appear.")
    return _moderation_page("⚠️ Unknown action", "Use the buttons in the notification email.")


# ── Guest book (3D room) ─────────────────────────────────────────────────────

@app.post("/guestbook")
def submit_guestbook(request: GuestbookRequest, http_req: Request) -> dict:
    _rate_limit(http_req, "guestbook", limit=8, window_seconds=300)
    if request.website.strip():
        return {"ok": True, "stored": False}
    name = (request.name or "").strip()
    note = (request.note or "").strip()
    if not name or len(name) > 80:
        raise HTTPException(status_code=422, detail="Please provide your name.")
    if len(note) < 2 or len(note) > 280:
        raise HTTPException(status_code=422, detail="Note must be between 2 and 280 characters.")
    creator = getattr(metadata_store, "create_guestbook_note", None)
    if not callable(creator):
        raise HTTPException(status_code=503, detail="Guest book is not available.")
    entry = creator(name=name, note=note, color=(request.color or "").strip()[:16])
    delivery = email_service.send_guestbook_notification(entry)
    return {"ok": True, "stored": True, "emailed": bool(delivery.get("sent"))}


@app.get("/guestbook")
def list_public_guestbook() -> dict:
    lister = getattr(metadata_store, "list_guestbook_notes", None)
    notes = lister(status="approved", limit=200) if callable(lister) else []
    return {"notes": notes}


@app.get("/guestbook/moderate")
def moderate_guestbook_confirm_page(token: str, action: str) -> HTMLResponse:
    if action not in {"approve", "reject"}:
        return _moderation_page("⚠️ Unknown action", "Use the buttons in the notification email.")
    getter = getattr(metadata_store, "get_guestbook_note_by_token", None)
    note = getter(token) if callable(getter) else None
    if not note:
        return _moderation_page("⚠️ Link expired", "This note could not be found. It may have already been handled.")
    name = html.escape(str(note.get("name") or "This"))
    return _moderation_page(
        f"Confirm: {'publish' if action == 'approve' else 'reject'} note",
        f"{name}'s guest book note — click below to {'pin it' if action == 'approve' else 'reject and hide it'}.",
        confirm_action=("/guestbook/moderate", token, action),
    )


@app.post("/guestbook/moderate")
def moderate_guestbook_confirm(token: str = Form(...), action: str = Form(...)) -> HTMLResponse:
    getter = getattr(metadata_store, "get_guestbook_note_by_token", None)
    note = getter(token) if callable(getter) else None
    if not note:
        return _moderation_page("⚠️ Link expired", "This note could not be found. It may have already been handled.")
    setter = getattr(metadata_store, "set_guestbook_status", None)
    if not callable(setter):
        return _moderation_page("⚠️ Unavailable", "The guest book cannot be moderated right now.")
    name = html.escape(str(note.get("name") or "This"))
    if action == "approve":
        setter(note["note_id"], "approved")
        return _moderation_page("✅ Note published", f"{name}'s note is now pinned in your 3D room.")
    if action == "reject":
        setter(note["note_id"], "rejected")
        return _moderation_page("🚫 Note rejected", f"{name}'s note has been hidden.")
    return _moderation_page("⚠️ Unknown action", "Use the buttons in the notification email.")


# ── Analytics events ─────────────────────────────────────────────────────────

@app.post("/events")
def record_event(request: EventRequest, http_req: Request) -> dict:
    _rate_limit(http_req, "events", limit=60, window_seconds=60)
    allowed = {"project_click", "resume_download", "chat_question", "recruiter_mode", "vcard_download", "review_start"}
    event_type = (request.event_type or "").strip()
    if event_type not in allowed:
        return {"ok": False}
    recorder = getattr(metadata_store, "record_event", None)
    if callable(recorder):
        try:
            # Server-side cap — the client already truncates, but that's not
            # something a caller hitting the API directly is bound by.
            recorder(event_type, (request.target or "").strip()[:200])
        except Exception:
            return {"ok": False}
    return {"ok": True}


@app.get("/admin/verify")
def verify_admin(x_admin_token: str | None = Header(default=None)) -> dict:
    """Validate an admin token. Returns ok=True when the token is accepted.

    When ADMIN_TOKEN is unset on the server, any token is accepted (local dev),
    and required=False signals the client that no gate is enforced.
    """
    _require_admin(x_admin_token)
    return {"ok": True, "required": bool(settings.admin_token)}


@app.get("/admin/settings")
def get_admin_settings() -> dict:
    return {
        "open_to_work": metadata_store.get_open_to_work(),
        "current_location": metadata_store.get_current_location(),
        "desired_locations": metadata_store.get_desired_locations(),
        **metadata_store.get_profile_overrides(),
        "experience": metadata_store.get_portfolio_experience(),
        "skills": metadata_store.get_portfolio_skills(),
    }


@app.put("/admin/settings")
def update_admin_settings(request: UpdateSettingsRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.set_open_to_work(request.open_to_work)
    metadata_store.set_current_location(request.current_location)
    metadata_store.set_desired_locations(request.desired_locations)
    metadata_store.set_profile_overrides(
        {
            "name": request.name,
            "location": request.location,
            "headline": request.headline,
            "about": request.about,
            "eyebrow": request.eyebrow,
        }
    )
    metadata_store.set_portfolio_experience(request.experience)
    metadata_store.set_portfolio_skills(request.skills)
    return {
        "open_to_work": metadata_store.get_open_to_work(),
        "current_location": metadata_store.get_current_location(),
        "desired_locations": metadata_store.get_desired_locations(),
        **metadata_store.get_profile_overrides(),
        "experience": metadata_store.get_portfolio_experience(),
        "skills": metadata_store.get_portfolio_skills(),
    }


@app.get("/admin/social-links")
def get_social_links(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    return metadata_store.get_social_links()


@app.put("/admin/social-links")
def update_social_links(request: SocialLinksRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.set_social_links({"linkedin": request.linkedin, "github": request.github, "email": request.email})
    return metadata_store.get_social_links()


@app.get("/admin/scheduling")
def admin_get_scheduling(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    getter = getattr(metadata_store, "get_scheduling", None)
    return getter() if callable(getter) else {}


@app.put("/admin/scheduling")
def admin_set_scheduling(request: SchedulingRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    setter = getattr(metadata_store, "set_scheduling", None)
    if callable(setter):
        setter(request.model_dump())
    getter = getattr(metadata_store, "get_scheduling", None)
    return getter() if callable(getter) else {}


@app.get("/admin/sections")
def admin_get_sections(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    return {"sections": portfolio_service._get_sections()}


@app.put("/admin/sections")
def admin_set_sections(request: SectionsRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    import json as _json

    allowed_ids = {s["id"] for s in portfolio_service.DEFAULT_SECTIONS}
    cleaned = [
        {
            "id": str(s.get("id")),
            "label": str(s.get("label") or "").strip(),
            "visible": bool(s.get("visible", True)),
        }
        for s in request.sections
        if isinstance(s, dict) and str(s.get("id")) in allowed_ids
    ]
    metadata_store.set_setting("sections", _json.dumps(cleaned))
    return {"sections": portfolio_service._get_sections()}


@app.get("/admin/messages")
def admin_list_messages(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    lister = getattr(metadata_store, "list_contact_messages", None)
    return {"messages": lister() if callable(lister) else []}


@app.put("/admin/messages/{message_id}/read")
def admin_mark_message_read(message_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    marker = getattr(metadata_store, "mark_contact_message_read", None)
    if callable(marker):
        marker(message_id, True)
    return {"ok": True}


@app.delete("/admin/messages/{message_id}")
def admin_delete_message(message_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    deleter = getattr(metadata_store, "delete_contact_message", None)
    if callable(deleter):
        deleter(message_id)
    return {"deleted": True}


@app.get("/admin/reviews")
def admin_list_reviews(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    lister = getattr(metadata_store, "list_reviews", None)
    return {"reviews": lister() if callable(lister) else []}


@app.put("/admin/reviews/{review_id}/approve")
def admin_approve_review(review_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    setter = getattr(metadata_store, "set_review_status", None)
    if callable(setter):
        setter(review_id, "approved")
    return {"ok": True}


@app.put("/admin/reviews/{review_id}/reject")
def admin_reject_review(review_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    setter = getattr(metadata_store, "set_review_status", None)
    if callable(setter):
        setter(review_id, "rejected")
    return {"ok": True}


@app.delete("/admin/reviews/{review_id}")
def admin_delete_review(review_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    deleter = getattr(metadata_store, "delete_review", None)
    if callable(deleter):
        deleter(review_id)
    return {"deleted": True}


@app.get("/admin/guestbook")
def admin_list_guestbook(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    lister = getattr(metadata_store, "list_guestbook_notes", None)
    return {"notes": lister() if callable(lister) else []}


@app.put("/admin/guestbook/{note_id}/approve")
def admin_approve_guestbook(note_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    setter = getattr(metadata_store, "set_guestbook_status", None)
    if callable(setter):
        setter(note_id, "approved")
    return {"ok": True}


@app.put("/admin/guestbook/{note_id}/reject")
def admin_reject_guestbook(note_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    setter = getattr(metadata_store, "set_guestbook_status", None)
    if callable(setter):
        setter(note_id, "rejected")
    return {"ok": True}


@app.delete("/admin/guestbook/{note_id}")
def admin_delete_guestbook(note_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    deleter = getattr(metadata_store, "delete_guestbook_note", None)
    if callable(deleter):
        deleter(note_id)
    return {"deleted": True}


@app.get("/admin/insights")
def admin_insights(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    getter = getattr(metadata_store, "get_event_summary", None)
    return getter() if callable(getter) else {"totals": [], "top_targets": []}


@app.post("/admin/ai/rewrite")
def admin_ai_rewrite(request: RewriteRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    try:
        draft, provider = ai_rewrite_service.rewrite(request.kind, request.fields, request.notes)
        return {"draft": draft, "provider": provider}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"AI rewrite failed: {exc}") from exc


@app.get("/admin/projects")
def list_admin_projects(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    return {"projects": metadata_store.list_portfolio_projects()}


@app.get("/admin/rag/documents")
def list_rag_documents(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    try:
        return {"documents": vector_store.list_active_documents(settings.chroma_collection_name)}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@app.get("/admin/chroma/documents")
def list_chroma_documents(x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    try:
        return {"documents": vector_store.list_active_documents(settings.chroma_collection_name)}
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@app.post("/admin/projects")
def create_admin_project(request: UpsertProjectRequest, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    project_id = metadata_store.upsert_portfolio_project(
        project_id=None,
        title=request.title.strip(),
        summary=request.summary.strip(),
        tech_stack=[item.strip() for item in request.tech_stack if item.strip()],
        source_path=(request.source_path or "Admin").strip() or "Admin",
        sort_order=int(request.sort_order or 0),
        what_it_does=[item.strip() for item in request.what_it_does if item.strip()],
        is_visible=request.is_visible,
        source_logical_document_key=request.source_logical_document_key,
        source_version_id=request.source_version_id,
    )
    return {"project": {"id": project_id}}


@app.put("/admin/projects/{project_id}")
def update_admin_project(
    project_id: str,
    request: UpsertProjectRequest,
    x_admin_token: str | None = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    updated_id = metadata_store.upsert_portfolio_project(
        project_id=project_id,
        title=request.title.strip(),
        summary=request.summary.strip(),
        tech_stack=[item.strip() for item in request.tech_stack if item.strip()],
        source_path=(request.source_path or "Admin").strip() or "Admin",
        sort_order=int(request.sort_order or 0),
        what_it_does=[item.strip() for item in request.what_it_does if item.strip()],
        is_visible=request.is_visible,
        source_logical_document_key=request.source_logical_document_key,
        source_version_id=request.source_version_id,
    )
    return {"project": {"id": updated_id}}


@app.delete("/admin/projects/{project_id}")
def delete_admin_project(project_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.delete_portfolio_project(project_id)
    return {"deleted": True}


@app.put("/admin/documents/{logical_document_key}/versions/{version_id}/activate")
def activate_document_version(logical_document_key: str, version_id: str, x_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    metadata_store.activate_version(logical_document_key, version_id)
    return {"status": "activated"}


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    project = None
    if hasattr(metadata_store, "get_portfolio_project"):
        project = getattr(metadata_store, "get_portfolio_project")(project_id)
    if not project:
        # Fallback: support built-in seed markdown projects (not stored in DB).
        try:
            from pathlib import Path as _Path

            for path in getattr(portfolio_service, "project_files", []):
                seed_path = _Path(path)
                if not seed_path.exists():
                    continue
                base_payload = portfolio_service._project_payload(seed_path)
                if str(base_payload.get("id") or "") == project_id:
                    markdown = seed_path.read_text(encoding="utf-8", errors="ignore")
                    extracted = extract_project_card(markdown, fallback_title=str(base_payload.get("title") or seed_path.stem))
                    project = {
                        **base_payload,
                        "whatItDoes": extracted.get("whatItDoes") or [],
                    }
                    break
        except Exception:
            project = None
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # If we have a source version, derive "what it does" from the parsed markdown (best-effort).
    if not project.get("whatItDoes") and project.get("sourceVersionId"):
        version = metadata_store.get_version(str(project["sourceVersionId"])) or {}
        parsed_path = version.get("parse_artifact_path")
        if parsed_path:
            try:
                markdown = Path(str(parsed_path)).read_text(encoding="utf-8", errors="ignore")
                extracted = extract_project_card(markdown, fallback_title=str(project.get("title") or "Project"))
                project["whatItDoes"] = extracted.get("whatItDoes") or []
                if not project.get("techStack"):
                    project["techStack"] = extracted.get("techStack") or []
                if not project.get("summary"):
                    project["summary"] = extracted.get("summary") or project.get("title") or ""
            except Exception:
                pass
    return {"project": project}


@app.post("/upload", response_model=UploadResponse)
async def upload_document(
    http_req: Request,
    file: UploadFile = File(...),
    logical_document_key: str = Form(...),
    source_label: str | None = Form(default=None),
    ingest_now: bool = Form(default=True),
    create_project: bool = Form(default=False),
    project_id: str | None = Form(default=None),
    project_title: str | None = Form(default=None),
    project_sort_order: int = Form(default=0),
    project_source_path: str | None = Form(default=None),
    x_admin_token: str | None = Header(default=None),
) -> UploadResponse:
    # Always admin-gated — this used to only check the token when
    # create_project was set, which meant anyone could upload a file and
    # trigger (paid) embedding/ingestion with zero authentication.
    _require_admin(x_admin_token)
    _rate_limit(http_req, "upload", limit=10, window_seconds=300)
    try:
        suffix = Path(file.filename or "").suffix.lower()
        placeholder_path = f"pending/{logical_document_key}/{file.filename or 'upload'}"
        version_id = metadata_store.create_version(
            logical_document_key=logical_document_key,
            file_name=file.filename or "upload",
            file_type=suffix.lstrip("."),
            storage_path=placeholder_path,
            source_label=source_label,
        )
        stored_path = save_upload(file, logical_document_key, version_id)
        metadata_store.update_storage_path(version_id, str(stored_path))
        metadata_store.update_status(version_id, "uploaded")

        chunk_count = ingestion_service.ingest(version_id) if ingest_now else 0
        response = UploadResponse(
            logical_document_key=logical_document_key,
            version_id=version_id,
            status="indexed" if ingest_now else "uploaded",
            chunk_count=chunk_count,
        )

        if create_project and ingest_now:
            version = metadata_store.get_version(version_id) or {}
            parsed_path = version.get("parse_artifact_path")
            markdown = ""
            if parsed_path:
                try:
                    markdown = Path(str(parsed_path)).read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    markdown = ""
            fallback_title = (project_title or file.filename or logical_document_key or "Project").strip()
            extracted = extract_project_card(markdown, fallback_title=fallback_title)
            title = (project_title or str(extracted.get("title") or fallback_title)).strip() or fallback_title
            summary = str(extracted.get("summary") or "").strip()
            tech_stack = extracted.get("techStack") if isinstance(extracted.get("techStack"), list) else []
            what_it_does = extracted.get("whatItDoes") if isinstance(extracted.get("whatItDoes"), list) else []
            source_path = (project_source_path or file.filename or "Admin").strip() or "Admin"
            saved_project_id = metadata_store.upsert_portfolio_project(
                project_id=(project_id.strip() if project_id else None),
                title=title,
                summary=summary or title,
                tech_stack=[str(item).strip() for item in tech_stack if str(item).strip()],
                what_it_does=[str(item).strip() for item in what_it_does if str(item).strip()],
                source_path=source_path,
                sort_order=int(project_sort_order or 0),
                source_logical_document_key=logical_document_key,
                source_version_id=version_id,
            )
            response.project_id = saved_project_id

        return response
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/ingest", response_model=UploadResponse)
def ingest_document(request: IngestRequest, http_req: Request, x_admin_token: str | None = Header(default=None)) -> UploadResponse:
    # Had no auth at all before — anyone who obtained/guessed a version_id
    # (e.g. from the /upload response) could trigger re-ingestion on demand.
    _require_admin(x_admin_token)
    _rate_limit(http_req, "ingest", limit=10, window_seconds=300)
    try:
        chunk_count = ingestion_service.ingest(request.version_id)
        return UploadResponse(
            logical_document_key=request.logical_document_key,
            version_id=request.version_id,
            status="indexed",
            chunk_count=chunk_count,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, http_req: Request) -> ChatResponse:
    _rate_limit(http_req, "chat", limit=20, window_seconds=60)
    try:
        return chat_service.answer(
            request.message,
            include_debug=request.include_debug,
            history=request.history,
            active_project_title=request.active_project_title,
        )
    except Exception as exc:  # noqa: BLE001
        # Don't leak internal exception text (file paths, provider errors, etc.)
        # to an unauthenticated caller — this endpoint has no admin gate. Still
        # chained via `from exc` so the real traceback reaches server logs.
        raise HTTPException(status_code=502, detail="I'm having trouble answering right now — please try again shortly.") from exc


@app.get("/documents", response_model=list[DocumentSummary])
def list_documents() -> list[DocumentSummary]:
    return [DocumentSummary(**item) for item in metadata_store.list_documents()]


@app.get("/documents/{logical_document_key}/versions", response_model=list[DocumentVersion])
def list_versions(logical_document_key: str) -> list[DocumentVersion]:
    return [DocumentVersion(**item) for item in metadata_store.list_versions(logical_document_key)]
