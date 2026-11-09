import json
import smtplib
import ssl
import time
from contextlib import closing
from email.message import EmailMessage
from http.client import HTTPException, HTTPSConnection

from app.core.config import get_settings


class EmailDeliveryError(RuntimeError):
    pass


def _brevo_error_code(response_body: bytes) -> str | None:
    if not isinstance(response_body, bytes):
        return None
    try:
        payload = json.loads(response_body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict) or not isinstance(payload.get("code"), str):
        return None
    code = payload["code"].strip()
    if not code or len(code) > 80 or not all(char.isalnum() or char in "_.-" for char in code):
        return None
    return code


def send_identity_email(recipient: str, subject: str, body: str) -> None:
    settings = get_settings()
    if settings.mail_provider == "brevo":
        if not settings.mail_password:
            raise EmailDeliveryError("Brevo API key is missing")
        payload = json.dumps(
            {
                "sender": {"email": settings.mail_from},
                "to": [{"email": recipient}],
                "subject": subject,
                "textContent": body,
            }
        ).encode("utf-8")
        try:
            for attempt in range(2):
                with closing(
                    HTTPSConnection(
                        "api.brevo.com", timeout=10, context=ssl.create_default_context()
                    )
                ) as client:
                    client.request(
                        "POST",
                        "/v3/smtp/email",
                        body=payload,
                        headers={
                            "api-key": settings.mail_password.get_secret_value(),
                            "Content-Type": "application/json",
                            "User-Agent": "VendorsMarket/0.1",
                        },
                    )
                    response = client.getresponse()
                    status = response.status
                    response_body = (
                        b"" if status in {502, 503, 504} and attempt == 0 else response.read()
                    )
                if status in {502, 503, 504} and attempt == 0:
                    time.sleep(1)
                    continue
                if not 200 <= status < 300:
                    error_code = _brevo_error_code(response_body)
                    detail = f"; code={error_code}" if error_code else ""
                    raise EmailDeliveryError(f"Brevo rejected email (HTTP {status}{detail})")
                result = json.loads(response_body)
                if (
                    not isinstance(result, dict)
                    or not isinstance(result.get("messageId"), str)
                    or not result["messageId"].strip()
                ):
                    raise EmailDeliveryError("Brevo returned no message ID")
                return
        except (OSError, HTTPException, ValueError) as exc:
            raise EmailDeliveryError(f"Brevo email request failed ({type(exc).__name__})") from None

    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=10) as client:
        if settings.mail_starttls:
            client.starttls(context=ssl.create_default_context())
        if settings.mail_username and settings.mail_password:
            client.login(settings.mail_username, settings.mail_password.get_secret_value())
        client.send_message(message)
