import smtplib
import socket
import ssl

import certifi
import pytest

from app.core.config import Settings
from app.services import mailer
from app.services.mailer import MailFailed, SmtpMailer, build_mailer

pytestmark = pytest.mark.anyio


class FakeSmtp:
    made: list["FakeSmtp"] = []
    connect_error: BaseException | None = None
    refused: set[str] = set()

    def __init__(self, host: str, port: int, timeout: float, context=None) -> None:
        if FakeSmtp.connect_error is not None:
            raise FakeSmtp.connect_error
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
        self.password = password
        if password == "wrong":
            raise smtplib.SMTPAuthenticationError(535, b"no")
        self.steps.append(f"login {username}")

    def send_message(self, message) -> None:
        if message["To"] in FakeSmtp.refused:
            raise smtplib.SMTPRecipientsRefused({message["To"]: (550, b"no such user")})
        self.sent = message


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeSmtp.made = []
    FakeSmtp.connect_error = None
    FakeSmtp.refused = set()
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
    assert smtp.password == "abcdefghijklmnop"


async def test_other_mail_servers_get_the_password_exactly_as_typed() -> None:
    sender = build_mailer(
        Settings(
            _env_file=None,
            smtp_host="smtp.example.com",
            smtp_username="me@example.com",
            smtp_password="pass with spaces",
        )
    )

    await sender.send("asha@example.com", "Hi", "Hello")

    assert FakeSmtp.made[0].password == "pass with spaces"


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


@pytest.mark.parametrize(
    ("error", "said"),
    [
        (
            ssl.SSLCertVerificationError("certificate verify failed"),
            "security certificate",
        ),
        (TimeoutError("timed out"), "SMTP_PORT=587"),
        (socket.gaierror(-2, "Name or service not known"), "could not be reached on port 465"),
        (ConnectionRefusedError("refused"), "could not be reached"),
        (smtplib.SMTPServerDisconnected("gone"), "backend window says why"),
    ],
    ids=["certificate", "timeout", "no-dns", "refused", "dropped"],
)
async def test_each_kind_of_failure_is_named(error: BaseException, said: str) -> None:
    FakeSmtp.connect_error = error

    with pytest.raises(MailFailed) as failed:
        await SmtpMailer("smtp.gmail.com", 465, "me", "pw", "me").send("a@example.com", "Hi", "x")

    assert said in str(failed.value)
    assert failed.value.detail.startswith(type(error).__name__)


async def test_a_refused_address_is_explained() -> None:
    FakeSmtp.refused = {"nobody@example.com"}

    with pytest.raises(MailFailed) as failed:
        await SmtpMailer("smtp.gmail.com", 465, "me", "pw", "me").send(
            "nobody@example.com", "Hi", "x"
        )

    assert "typed correctly" in str(failed.value)


def test_certificates_come_from_a_known_good_list() -> None:
    context = mailer.secure_context()

    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname
    assert context.cert_store_stats()["x509_ca"] > 50
    assert certifi.where().endswith("cacert.pem")
