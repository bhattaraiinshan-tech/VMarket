import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


def send_identity_email(recipient: str, subject: str, body: str) -> None:
    settings = get_settings()
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=10) as client:
        if settings.mail_starttls:
            client.starttls()
        if settings.mail_username and settings.mail_password:
            client.login(settings.mail_username, settings.mail_password.get_secret_value())
        client.send_message(message)
