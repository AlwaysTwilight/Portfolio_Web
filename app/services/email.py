from __future__ import annotations

import html

import requests

from app.config import settings


RESEND_ENDPOINT = "https://api.resend.com/emails"


class EmailService:
    """Thin wrapper over the Resend REST API.

    Sends transactional notification emails when a visitor submits the contact
    form (or asks the chatbot to pass along a message). If RESEND_API_KEY is not
    configured, send() is a no-op that reports it was skipped — the caller still
    persists the message to the database, so nothing is lost.
    """

    def is_configured(self) -> bool:
        return bool(settings.resend_api_key and settings.contact_notify_email)

    def send_contact_notification(self, name: str, email: str, message: str, source: str = "form") -> dict:
        if not self.is_configured():
            return {"sent": False, "reason": "email_not_configured"}

        safe_name = html.escape(name.strip() or "Someone")
        safe_email = html.escape(email.strip())
        safe_message = html.escape(message.strip()).replace("\n", "<br>")
        origin = "chatbot" if source == "chat" else "contact form"

        subject = f"New portfolio message from {name.strip() or 'a visitor'}"
        body_html = f"""
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="margin:0 0 4px;color:#111;">New message via your portfolio</h2>
          <p style="color:#666;font-size:13px;margin:0 0 20px;">Received through the {origin}.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#888;width:80px;">Name</td><td style="padding:6px 0;color:#111;">{safe_name}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Email</td><td style="padding:6px 0;"><a href="mailto:{safe_email}" style="color:#4f46e5;">{safe_email}</a></td></tr>
          </table>
          <div style="margin-top:16px;padding:16px;background:#f6f6f7;border-radius:10px;color:#222;line-height:1.6;font-size:14px;">
            {safe_message}
          </div>
          <p style="margin-top:20px;color:#999;font-size:12px;">Reply directly to this email to respond to {safe_name}.</p>
        </div>
        """

        payload = {
            "from": f"Portfolio <{settings.contact_from_email}>",
            "to": [settings.contact_notify_email],
            "subject": subject,
            "html": body_html,
            "reply_to": email.strip() or settings.contact_notify_email,
        }
        return self._send(payload)

    def _send(self, payload: dict) -> dict:
        if not self.is_configured():
            return {"sent": False, "reason": "email_not_configured"}
        try:
            resp = requests.post(
                RESEND_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15,
            )
            if resp.status_code >= 400:
                return {"sent": False, "reason": f"resend_error_{resp.status_code}", "detail": resp.text[:300]}
            return {"sent": True, "id": (resp.json() or {}).get("id")}
        except Exception as exc:  # noqa: BLE001
            return {"sent": False, "reason": "request_failed", "detail": str(exc)[:300]}

    @staticmethod
    def _moderate_url(kind: str, token: str, action: str) -> str:
        base = settings.public_base_url.rstrip("/")
        return f"{base}/{kind}/moderate?token={token}&action={action}"

    @staticmethod
    def _button(url: str, label: str, color: str) -> str:
        return (
            f'<a href="{url}" style="display:inline-block;padding:10px 22px;margin:0 6px;'
            f'background:{color};color:#fff;border-radius:8px;text-decoration:none;'
            f'font-size:14px;font-weight:600;">{label}</a>'
        )

    def send_review_notification(self, review: dict) -> dict:
        if not self.is_configured():
            return {"sent": False, "reason": "email_not_configured"}

        name = html.escape(str(review.get("name") or "Someone"))
        position = html.escape(str(review.get("position") or ""))
        company = html.escape(str(review.get("company") or ""))
        text = html.escape(str(review.get("review_text") or "")).replace("\n", "<br>")
        rating = int(review.get("rating") or 0)
        stars = ("★" * rating + "☆" * (5 - rating)) if rating else "— no rating —"
        linkedin = str(review.get("linkedin_url") or "").strip()
        skills = [html.escape(str(s)) for s in (review.get("endorsed_skills") or [])]
        token = str(review.get("approval_token") or "")

        role_line = position + (f" · {company}" if company else "")
        linkedin_html = (
            f'<tr><td style="padding:6px 0;color:#888;">LinkedIn</td>'
            f'<td style="padding:6px 0;"><a href="{html.escape(linkedin)}" style="color:#4f46e5;">{html.escape(linkedin)}</a></td></tr>'
            if linkedin else ""
        )
        skills_html = (
            f'<tr><td style="padding:6px 0;color:#888;">Endorses</td>'
            f'<td style="padding:6px 0;color:#111;">{", ".join(skills)}</td></tr>'
            if skills else ""
        )

        approve_url = self._moderate_url("reviews", token, "approve")
        reject_url = self._moderate_url("reviews", token, "reject")

        body_html = f"""
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="margin:0 0 4px;color:#111;">New review awaiting your approval</h2>
          <p style="color:#666;font-size:13px;margin:0 0 20px;">It stays hidden until you approve it.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <tr><td style="padding:6px 0;color:#888;width:90px;">From</td><td style="padding:6px 0;color:#111;">{name}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Role</td><td style="padding:6px 0;color:#111;">{role_line}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Rating</td><td style="padding:6px 0;color:#f59e0b;font-size:16px;">{stars}</td></tr>
            {linkedin_html}
            {skills_html}
          </table>
          <div style="margin-top:16px;padding:16px;background:#f6f6f7;border-radius:10px;color:#222;line-height:1.6;font-size:14px;">
            {text}
          </div>
          <div style="margin-top:24px;text-align:center;">
            {self._button(approve_url, "✓ Approve &amp; publish", "#16a34a")}
            {self._button(reject_url, "✕ Reject", "#dc2626")}
          </div>
          <p style="margin-top:20px;color:#999;font-size:12px;text-align:center;">
            One-click links — no login needed. You can also manage reviews in the admin panel.
          </p>
        </div>
        """
        return self._send({
            "from": f"Portfolio <{settings.contact_from_email}>",
            "to": [settings.contact_notify_email],
            "subject": f"New review from {review.get('name') or 'a visitor'} — approve to publish",
            "html": body_html,
        })

    def send_guestbook_notification(self, note: dict) -> dict:
        if not self.is_configured():
            return {"sent": False, "reason": "email_not_configured"}

        name = html.escape(str(note.get("name") or "Someone"))
        text = html.escape(str(note.get("note") or "")).replace("\n", "<br>")
        token = str(note.get("approval_token") or "")
        approve_url = self._moderate_url("guestbook", token, "approve")
        reject_url = self._moderate_url("guestbook", token, "reject")

        body_html = f"""
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;">
          <h2 style="margin:0 0 4px;color:#111;">New guest book note awaiting approval</h2>
          <p style="color:#666;font-size:13px;margin:0 0 16px;">Left by {name} in your 3D room.</p>
          <div style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;color:#222;line-height:1.6;font-size:14px;">
            {text}
          </div>
          <div style="margin-top:24px;text-align:center;">
            {self._button(approve_url, "✓ Approve", "#16a34a")}
            {self._button(reject_url, "✕ Reject", "#dc2626")}
          </div>
        </div>
        """
        return self._send({
            "from": f"Portfolio <{settings.contact_from_email}>",
            "to": [settings.contact_notify_email],
            "subject": f"New guest book note from {note.get('name') or 'a visitor'}",
            "html": body_html,
        })


email_service = EmailService()
