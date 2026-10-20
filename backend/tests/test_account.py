import re
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services import account_store
from app.services.account_store import AccountStore, password_matches
from app.services.mailer import MailFailed
from app.services.meeting_store import MeetingStore
from tests.conftest import ELSEWHERE, TEST_HOST, VALID_BODY, make_client
from tests.fakes import FakeMailer, FakeTranslator

EMAIL = "asha@example.com"
PASSWORD = "plenty-long-secret"
CODE = re.compile(r"\b(\d{6})\b")
SOON = (datetime.now(UTC) + timedelta(days=30)).isoformat()


def setup(**changes):
    mailer = FakeMailer()
    client = make_client(translator=FakeTranslator(), mailer=mailer, **changes)
    return client, mailer


def code_in(mailer: FakeMailer) -> str:
    found = CODE.search(mailer.letters[-1].text)
    assert found is not None
    return found.group(1)


def sign_up(client, mailer, email: str = EMAIL, password: str = PASSWORD, name: str = "Asha"):
    assert (
        client.post("/api/account/code", json={"email": email, "purpose": "sign_up"}).status_code
        == 202
    )
    return client.post(
        "/api/account/sign-up",
        json={"email": email, "code": code_in(mailer), "name": name, "password": password},
    )


def elsewhere(client: TestClient) -> TestClient:
    return TestClient(client.app, base_url=f"http://{TEST_HOST}", client=ELSEWHERE)


def test_an_account_is_made_with_an_emailed_code_and_signs_you_in() -> None:
    client, mailer = setup()

    response = sign_up(client, mailer, email="  Asha@Example.COM ")

    assert response.status_code == 201
    assert response.json()["email"] == EMAIL
    assert mailer.letters[0].to == EMAIL
    assert "10 minutes" in mailer.letters[0].text
    cookie = response.headers["set-cookie"]
    assert "vt_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    me = client.get("/api/account").json()
    assert (me["name"], me["email"], me["owner"]) == ("Asha", EMAIL, True)


def test_the_password_is_kept_only_as_a_scrypt_fingerprint(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    store.create(EMAIL, "Asha", PASSWORD)
    store.close()

    (stored,) = (
        sqlite3.connect(tmp_path / "accounts.db")
        .execute("SELECT password_hash FROM users")
        .fetchone()
    )

    assert stored.startswith("scrypt$") and PASSWORD not in stored
    assert password_matches(PASSWORD, stored)
    assert not password_matches(PASSWORD + "!", stored)
    assert not password_matches(PASSWORD, "not-a-hash")


def test_a_wrong_code_is_refused_and_five_wrong_tries_end_the_code() -> None:
    client, mailer = setup()
    client.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})
    right = code_in(mailer)
    wrong = "000000" if right != "000000" else "111111"
    body = {"email": EMAIL, "name": "Asha", "password": PASSWORD}

    answers = [
        client.post("/api/account/sign-up", json={**body, "code": wrong}).status_code
        for _ in range(5)
    ]
    late = client.post("/api/account/sign-up", json={**body, "code": right})

    assert answers == [400] * 5
    assert late.status_code == 400
    assert "Ask for a new one" in late.json()["detail"]


def test_an_old_code_no_longer_works(monkeypatch: pytest.MonkeyPatch) -> None:
    client, mailer = setup()
    monkeypatch.setattr(account_store, "CODE_LIFETIME", account_store.timedelta(seconds=-1))
    client.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})

    response = client.post(
        "/api/account/sign-up",
        json={"email": EMAIL, "code": code_in(mailer), "name": "Asha", "password": PASSWORD},
    )

    assert response.status_code == 400


def test_a_new_code_needs_a_short_wait() -> None:
    client, _ = setup()
    body = {"email": EMAIL, "purpose": "sign_up"}

    first = client.post("/api/account/code", json=body)
    again = client.post("/api/account/code", json=body)

    assert first.json() == {"sent": True, "resend_after": 60, "expires_in": 600}
    assert again.status_code == 429
    assert 1 <= int(again.headers["Retry-After"]) <= 61


def test_signing_up_twice_tells_the_owner_of_the_email_instead() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    other, _ = elsewhere(client), None

    answer = other.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})

    assert answer.status_code == 202
    assert mailer.letters[-1].subject == "You already have an account"
    assert not CODE.search(mailer.letters[-1].text)


def test_sign_in_needs_the_right_password_and_says_the_same_for_a_wrong_email() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    client.post("/api/account/sign-out")

    wrong = client.post("/api/account/sign-in", json={"email": EMAIL, "password": "nope-nope"})
    nobody = client.post(
        "/api/account/sign-in", json={"email": "x@example.com", "password": PASSWORD}
    )
    right = client.post("/api/account/sign-in", json={"email": EMAIL, "password": PASSWORD})

    assert (wrong.status_code, nobody.status_code, right.status_code) == (401, 401, 200)
    assert wrong.json() == nobody.json()
    assert client.get("/api/account").status_code == 200


def test_the_backend_window_says_why_a_sign_in_failed(caplog: pytest.LogCaptureFixture) -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    caplog.set_level("INFO", logger="app.api.account")

    client.post("/api/account/sign-in", json={"email": EMAIL, "password": "nope-nope"})
    client.post("/api/account/sign-in", json={"email": "ravi@example.com", "password": PASSWORD})

    lines = [record.getMessage() for record in caplog.records]
    assert "Sign-in refused for a***@example.com: wrong password" in lines
    assert any(
        line.startswith("Sign-in refused for r***@example.com: no account") for line in lines
    )
    assert not any(PASSWORD in line or "nope-nope" in line or EMAIL in line for line in lines)


def test_codes_and_new_accounts_are_noted_without_full_emails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app.api.account")
    client, mailer = setup()

    sign_up(client, mailer)

    lines = [record.getMessage() for record in caplog.records]
    assert "Account email sent to a***@example.com: a code" in lines
    assert "Account created for a***@example.com" in lines
    assert not any(EMAIL in line or code_in(mailer) in line for line in lines)


def test_the_backend_window_says_whether_codes_can_be_emailed(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level("INFO", logger="app.main")
    missing = create_app(Settings(_env_file=None), meeting_store=MeetingStore(None))
    ready = create_app(
        Settings(_env_file=None, smtp_username="owner@gmail.com", smtp_password="abcd"),
        meeting_store=MeetingStore(None),
    )

    with TestClient(missing), TestClient(ready):
        lines = [record.getMessage() for record in caplog.records]

    assert any(line.startswith("Email codes are not set up") for line in lines)
    assert "Sign-up and reset codes are emailed from o***@gmail.com" in lines


def test_emails_are_shortened_for_the_log() -> None:
    assert account_store.masked_email("thanos@gmail.com") == "t***@gmail.com"
    assert account_store.masked_email("broken") == "***"


def test_guessing_passwords_is_slowed_down() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    tries = [
        client.post("/api/account/sign-in", json={"email": EMAIL, "password": f"guess-{n}xx"})
        for n in range(6)
    ]

    assert [t.status_code for t in tries] == [401] * 5 + [429]
    assert "Wait" in tries[-1].json()["detail"]


def test_signing_out_ends_the_session() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    cookie = client.cookies.get("vt_session")

    response = client.post("/api/account/sign-out")

    assert response.status_code == 204
    assert client.get("/api/account").status_code == 401
    client.cookies.set("vt_session", cookie)
    assert client.get("/api/account").status_code == 401


def test_a_forgotten_password_is_reset_with_an_emailed_code() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    old_cookie = client.cookies.get("vt_session")
    stranger = elsewhere(client)

    unknown = stranger.post(
        "/api/account/code", json={"email": "x@example.com", "purpose": "reset"}
    )
    sent_before = len(mailer.letters)
    stranger.post("/api/account/code", json={"email": EMAIL, "purpose": "reset"})
    reset = stranger.post(
        "/api/account/reset",
        json={"email": EMAIL, "code": code_in(mailer), "password": "brand-new-secret"},
    )

    assert unknown.status_code == 202 and sent_before == 1
    assert reset.status_code == 200
    assert stranger.get("/api/account").json()["email"] == EMAIL
    client.cookies.set("vt_session", old_cookie)
    assert client.get("/api/account").status_code == 401
    assert (
        stranger.post(
            "/api/account/sign-in", json={"email": EMAIL, "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        stranger.post(
            "/api/account/sign-in", json={"email": EMAIL, "password": "brand-new-secret"}
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"password": "short"}, 422),
        ({"password": EMAIL}, 422),
        ({"email": "not-an-email"}, 422),
        ({"name": "  "}, 422),
        ({"code": "12345"}, 422),
        ({"admin": True}, 422),
    ],
    ids=["short-password", "password-is-email", "bad-email", "blank-name", "short-code", "extra"],
)
def test_sign_up_checks_what_it_is_given(body: dict, status: int) -> None:
    client, _ = setup()
    full = {"email": EMAIL, "code": "123456", "name": "Asha", "password": PASSWORD, **body}

    assert client.post("/api/account/sign-up", json=full).status_code == status


def test_without_email_set_up_the_reason_is_given() -> None:
    client, _ = setup()
    client.app.state.mailer = None

    response = client.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})

    assert response.status_code == 503
    assert "SMTP_USERNAME" in response.json()["detail"]


def test_an_email_that_cannot_be_sent_says_why() -> None:
    client, mailer = setup()
    mailer.failure = MailFailed("The email account refused the login.")

    response = client.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})

    assert (response.status_code, response.json()["detail"]) == (
        503,
        "The email account refused the login.",
    )


def test_changing_the_password_needs_the_current_one() -> None:
    client, mailer = setup()
    sign_up(client, mailer)

    wrong = client.put(
        "/api/account/password", json={"current": "nope", "password": "another-secret"}
    )
    right = client.put(
        "/api/account/password", json={"current": PASSWORD, "password": "another-secret"}
    )

    assert (wrong.status_code, right.status_code) == (401, 200)
    assert client.get("/api/account").status_code == 200
    client.post("/api/account/sign-out")
    assert (
        client.post(
            "/api/account/sign-in", json={"email": EMAIL, "password": "another-secret"}
        ).status_code
        == 200
    )


def test_a_name_can_be_changed() -> None:
    client, mailer = setup()
    sign_up(client, mailer)

    assert client.put("/api/account/name", json={"name": " Asha R "}).json()["name"] == "Asha R"


def test_deleting_the_account_removes_it_and_its_meetings() -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    person = elsewhere(client)
    person.post("/api/account/sign-in", json={"email": EMAIL, "password": PASSWORD})
    meeting = {
        "title": "Budget",
        "starts_at": SOON,
        "duration_minutes": 30,
        "host_name": "Asha",
    }
    assert person.post("/api/meetings", json=meeting).status_code == 201

    refused = person.post("/api/account/delete", json={"password": "wrong-one"})
    gone = person.post("/api/account/delete", json={"password": PASSWORD})

    assert (refused.status_code, gone.status_code) == (401, 204)
    assert person.get("/api/account").status_code == 401
    assert (
        person.post("/api/account/sign-in", json={"email": EMAIL, "password": PASSWORD}).status_code
        == 401
    )
    assert client.app.state.meetings.upcoming(None, with_unowned=True) == []


def test_people_signed_in_from_elsewhere_can_translate_within_a_daily_limit() -> None:
    client, mailer = setup(settings=None)
    client.app.state.settings.user_requests_per_day = 3
    sign_up(client, mailer)
    person = elsewhere(client)

    assert person.post("/api/sessions", json=VALID_BODY).status_code == 401
    person.post("/api/account/sign-in", json={"email": EMAIL, "password": PASSWORD})
    statuses = [person.post("/api/sessions", json=VALID_BODY).status_code for _ in range(4)]

    assert statuses == [201, 201, 201, 429]
    assert person.get("/api/access").json() == {"host": True}
    assert person.get("/api/account").json()["owner"] is False
    assert person.get("/api/keys").status_code == 401


def test_each_person_sees_only_their_own_meetings() -> None:
    client, mailer = setup()
    sign_up(client, mailer, email="one@example.com")
    client.post("/api/account/sign-out")
    sign_up(client, mailer, email="two@example.com", name="Two")
    client.post("/api/account/sign-out")
    one, two = elsewhere(client), elsewhere(client)
    one.post("/api/account/sign-in", json={"email": "one@example.com", "password": PASSWORD})
    two.post("/api/account/sign-in", json={"email": "two@example.com", "password": PASSWORD})
    meeting = {
        "title": "Mine",
        "starts_at": SOON,
        "duration_minutes": 30,
        "host_name": "One",
    }

    one.post("/api/meetings", json=meeting)

    assert [m["title"] for m in one.get("/api/meetings").json()["meetings"]] == ["Mine"]
    assert two.get("/api/meetings").json()["meetings"] == []
    assert elsewhere(client).get("/api/meetings").status_code == 401


def test_the_session_cookie_is_secure_through_the_public_link() -> None:
    client, mailer = setup()
    client.post("/api/account/code", json={"email": EMAIL, "purpose": "sign_up"})

    response = client.post(
        "/api/account/sign-up",
        json={"email": EMAIL, "code": code_in(mailer), "name": "Asha", "password": PASSWORD},
        headers={"X-Forwarded-Proto": "https"},
    )

    assert "Secure" in response.headers["set-cookie"]


def test_signing_in_lasts_until_the_browser_closes() -> None:
    client, mailer = setup()

    cookie = sign_up(client, mailer).headers["set-cookie"].lower()

    assert "vt_session=" in cookie and "httponly" in cookie
    assert "max-age" not in cookie and "expires" not in cookie


def test_an_unused_sign_in_ends_after_twelve_hours(monkeypatch: pytest.MonkeyPatch) -> None:
    client, mailer = setup()
    sign_up(client, mailer)
    started = datetime.now(UTC)

    monkeypatch.setattr(account_store, "_now", lambda: started + timedelta(hours=11))
    still = client.get("/api/account").status_code
    monkeypatch.setattr(account_store, "_now", lambda: started + timedelta(hours=22))
    kept_alive = client.get("/api/account").status_code
    monkeypatch.setattr(account_store, "_now", lambda: started + timedelta(hours=35))
    ended = client.get("/api/account").status_code

    assert (still, kept_alive, ended) == (200, 200, 401)
