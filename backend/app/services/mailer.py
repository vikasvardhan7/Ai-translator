import asyncio
import smtplib
import socket
import ssl
from email.message import EmailMessage
from typing import Protocol

import certifi

from app.core.config import Settings

SMTP_TIMEOUT_SECONDS = 20
IMPLICIT_TLS_PORT = 465
GOOGLE_HOSTS = ("smtp.gmail.com", "smtp.googlemail.com")


class MailFailed(Exception):
    def __init__(self, message: str, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.detail = f"{type(cause).__name__}: {str(cause)[:200]}" if cause else message


def secure_context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())


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
        context = secure_context()
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
                " in backend/.env.",
                exc,
            ) from exc
        except smtplib.SMTPRecipientsRefused as exc:
            raise MailFailed(
                "The mail server would not send to this address. Check that it is typed correctly.",
                exc,
            ) from exc
        except ssl.SSLCertVerificationError as exc:
            raise MailFailed(
                "This computer could not check the mail server's security certificate. Check"
                " that the computer's date and time are right, and that no antivirus or company"
                " network is inspecting secure connections.",
                exc,
            ) from exc
        except (TimeoutError, ConnectionError, socket.gaierror) as exc:
            raise MailFailed(
                f"The mail server {self._host} could not be reached on port {self._port}. Check the"
                " internet connection; if this network blocks it, set SMTP_PORT=587 in"
                " backend/.env and start the backend again.",
                exc,
            ) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailFailed(
                "The email could not be sent. The backend window says why.", exc
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
    if settings.smtp_host.lower() in GOOGLE_HOSTS:
        password = "".join(password.split())
    if not (settings.smtp_host and settings.smtp_username and password):
        return None
    sender = settings.mail_from or f"{settings.app_name} <{settings.smtp_username}>"
    return SmtpMailer(
        settings.smtp_host, settings.smtp_port, settings.smtp_username, password, sender
    )
