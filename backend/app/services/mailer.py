import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings

SMTP_TIMEOUT_SECONDS = 20
IMPLICIT_TLS_PORT = 465


class MailFailed(Exception):
    pass


class Mailer(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class SmtpMailer:
    def __init__(self, host: str, port: int, username: str, password: str, sender: str) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._sender = sender

    def _send_now(self, message: EmailMessage) -> None:
        context = ssl.create_default_context()
        try:
            if self._port == IMPLICIT_TLS_PORT:
                with smtplib.SMTP_SSL(
                    self._host, self._port, timeout=SMTP_TIMEOUT_SECONDS, context=context
                ) as smtp:
                    smtp.login(self._username, self._password)
                    smtp.send_message(message)
            else:
                with smtplib.SMTP(self._host, self._port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
                    smtp.starttls(context=context)
                    smtp.login(self._username, self._password)
                    smtp.send_message(message)
        except smtplib.SMTPAuthenticationError as exc:
            raise MailFailed(
                "The email account refused the login. Check SMTP_USERNAME and the app password"
                " in backend/.env."
            ) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailFailed(
                "The email could not be sent. Check the internet connection and the SMTP settings."
            ) from exc

    async def send(self, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self._sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        await asyncio.to_thread(self._send_now, message)


def build_mailer(settings: Settings) -> Mailer | None:
    password = settings.smtp_password.get_secret_value() if settings.smtp_password else ""
    if not (settings.smtp_host and settings.smtp_username and password):
        return None
    sender = settings.mail_from or f"{settings.app_name} <{settings.smtp_username}>"
    return SmtpMailer(
        settings.smtp_host, settings.smtp_port, settings.smtp_username, password, sender
    )
