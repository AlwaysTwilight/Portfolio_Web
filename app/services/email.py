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


email_service = EmailService()
