import smtplib

import pytest

from app.core.config import Settings
from app.services import mailer
from app.services.mailer import MailFailed, SmtpMailer, build_mailer

pytestmark = pytest.mark.anyio


class FakeSmtp:
    made: list["FakeSmtp"] = []

    def __init__(self, host: str, port: int, timeout: float, context=None) -> None:
        self.host, self.port, self.secure_from_start = host, port, context is not None
        self.steps: list[str] = []
        self.sent = None
        FakeSmtp.made.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def starttls(self, context) -> None:
        self.steps.append("starttls")

    def login(self, username: str, password: str) -> None:
        if password == "wrong":
            raise smtplib.SMTPAuthenticationError(535, b"no")
        self.steps.append(f"login {username}")

    def send_message(self, message) -> None:
        self.sent = message


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.made = []
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSmtp)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSmtp)


async def test_gmail_is_reached_over_tls_and_the_letter_is_sent() -> None:
    sender = build_mailer(
        Settings(_env_file=None, smtp_username="me@gmail.com", smtp_password="abcd efgh ijkl mnop")
    )

    await sender.send("asha@example.com", "Your code is 123456", "Your code is 123456.")

    (smtp,) = FakeSmtp.made
    assert (smtp.host, smtp.port, smtp.secure_from_start) == ("smtp.gmail.com", 465, True)
    assert smtp.steps == ["login me@gmail.com"]
    assert smtp.sent["To"] == "asha@example.com"
    assert smtp.sent["From"] == "Voice Translator <me@gmail.com>"


async def test_port_587_upgrades_to_tls_first() -> None:
    await SmtpMailer("smtp.example.com", 587, "me", "secret", "Me <me@example.com>").send(
        "a@example.com", "Hi", "Hello"
    )

    assert FakeSmtp.made[0].steps == ["starttls", "login me"]


async def test_a_refused_login_is_explained() -> None:
    with pytest.raises(MailFailed) as failed:
        await SmtpMailer("smtp.gmail.com", 465, "me", "wrong", "me").send(
            "a@example.com", "Hi", "x"
        )

    assert "app password" in str(failed.value)


def test_no_mailer_without_a_login() -> None:
    assert build_mailer(Settings(_env_file=None)) is None
    assert build_mailer(Settings(_env_file=None, smtp_username="me@gmail.com")) is None
