import logging
import sys
from pathlib import Path

import pytest

from app.core.config import Settings
from app.services import public_address
from app.services.public_address import (
    DID_NOT_START,
    NOT_BUILT,
    NOT_INSTALLED,
    PublicAddress,
    find_cloudflared,
)
from tests.conftest import FRONTEND, HOST_KEY, make_client

pytestmark = pytest.mark.anyio

FAKE_ADDRESS = "https://quiet-river-fast.trycloudflare.com"
ANNOUNCING = (
    "import sys, time\n"
    "print('2026-10-19T00:00:00Z INF Requesting a quick tunnel', flush=True)\n"
    f"print('INF |  {FAKE_ADDRESS}  |', flush=True)\n"
    "print('INF Registered tunnel connection', flush=True)\n"
    "time.sleep(60)\n"
)
SILENT = "import time\ntime.sleep(60)\n"
FAILING = "import sys\nprint('ERR could not reach cloudflare', flush=True)\nsys.exit(1)\n"
HOST = {"consent": True, "host": {"name": "Host", "preferred_language": "en"}}


def fake_tunnel(script: str) -> list[str]:
    return [sys.executable, "-c", script]


async def test_the_tunnel_is_started_once_and_its_address_reused() -> None:
    public = PublicAddress(fake_tunnel(ANNOUNCING), app_served=True)

    first = await public.get("http://localhost:8000")
    second = await public.get("http://localhost:8000")
    process = public._process
    await public.aclose()

    assert (first, second) == (FAKE_ADDRESS, FAKE_ADDRESS)
    assert process is not None and process.returncode is not None


async def test_a_tunnel_that_stops_is_started_again() -> None:
    public = PublicAddress(fake_tunnel(ANNOUNCING), app_served=True)

    first = await public.get("http://localhost:8000")
    await public.aclose()
    second = await public.get("http://localhost:8000")
    await public.aclose()

    assert (first, second) == (FAKE_ADDRESS, FAKE_ADDRESS)


async def test_a_tunnel_that_fails_gives_no_address(caplog) -> None:
    caplog.set_level(logging.WARNING)
    public = PublicAddress(fake_tunnel(FAILING), app_served=True)

    address = await public.get("http://localhost:8000")
    await public.aclose()

    assert address is None
    assert "stopped before giving a public address" in caplog.text


async def test_a_tunnel_that_says_nothing_is_given_up_on(monkeypatch, caplog) -> None:
    caplog.set_level(logging.WARNING)
    monkeypatch.setattr(public_address, "ADDRESS_WAIT_SECONDS", 0.5)
    public = PublicAddress(fake_tunnel(SILENT), app_served=True)

    address = await public.get("http://localhost:8000")
    await public.aclose()

    assert address is None
    assert "no public address within" in caplog.text


async def test_a_missing_program_is_reported(caplog) -> None:
    caplog.set_level(logging.WARNING)
    public = PublicAddress(["no-such-program-anywhere"], app_served=True)

    assert await public.get("http://localhost:8000") is None
    assert "could not be started" in caplog.text


def test_the_problem_is_named_before_any_tunnel_is_tried() -> None:
    assert PublicAddress(None, app_served=True).problem == NOT_INSTALLED
    assert PublicAddress(["cloudflared"], app_served=False).problem == NOT_BUILT
    assert PublicAddress(["cloudflared"], app_served=True).problem is None


def test_cloudflared_is_found_in_settings_on_the_path_or_where_winget_puts_it(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(public_address.shutil, "which", lambda name: None)
    for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        monkeypatch.delenv(variable, raising=False)
    assert find_cloudflared("C:/tools/cloudflared.exe") == "C:/tools/cloudflared.exe"
    assert find_cloudflared(None) is None

    monkeypatch.setattr(public_address.shutil, "which", lambda name: "/usr/bin/cloudflared")
    assert find_cloudflared(None) == "/usr/bin/cloudflared"

    monkeypatch.setattr(public_address.shutil, "which", lambda name: None)
    winget = tmp_path / "Microsoft" / "WinGet" / "Packages" / "Cloudflare.cloudflared_x"
    winget.mkdir(parents=True)
    (winget / "cloudflared.exe").write_bytes(b"")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert find_cloudflared(None) == str(winget / "cloudflared.exe")


def test_an_invite_made_on_this_computer_gets_the_public_link() -> None:
    client = make_client()
    client.app.state.public_address = PublicAddress(fake_tunnel(ANNOUNCING), app_served=True)

    with client:
        first = client.post("/api/rooms", json=HOST).json()
        second = client.post("/api/rooms", json=HOST).json()

    assert (first["public_url"], first["public_url_problem"]) == (FAKE_ADDRESS, None)
    assert second["public_url"] == FAKE_ADDRESS


@pytest.mark.parametrize(
    ("public", "problem"),
    [
        (PublicAddress(None, app_served=True), NOT_INSTALLED),
        (PublicAddress(["cloudflared"], app_served=False), NOT_BUILT),
        (PublicAddress(fake_tunnel(FAILING), app_served=True), DID_NOT_START),
    ],
    ids=["not-installed", "not-built", "did-not-start"],
)
def test_an_invite_without_a_public_link_says_why(public: PublicAddress, problem: str) -> None:
    client = make_client()
    client.app.state.public_address = public

    with client:
        created = client.post("/api/rooms", json=HOST).json()

    assert (created["public_url"], created["public_url_problem"]) == (None, problem)


def test_an_invite_made_through_a_tunnel_uses_that_address() -> None:
    client = make_client()
    client.app.state.public_address = PublicAddress(None, app_served=True)
    headers = {
        "Host": "abc.trycloudflare.com",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For": "198.51.100.7",
        "X-Host-Key": HOST_KEY,
    }

    with client:
        created = client.post("/api/rooms", json=HOST, headers=headers).json()

    assert (created["public_url"], created["public_url_problem"]) == (
        "https://abc.trycloudflare.com",
        None,
    )


def test_a_configured_public_address_is_used_as_it_is() -> None:
    settings = Settings(
        _env_file=None, frontend_origin=FRONTEND, public_url="https://talk.example.org/"
    )
    client = make_client(settings)
    client.app.state.public_address = PublicAddress(None, app_served=True)

    with client:
        created = client.post("/api/rooms", json=HOST).json()

    assert created["public_url"] == "https://talk.example.org"


def test_the_tunnel_is_closed_with_the_backend() -> None:
    client = make_client()
    public = PublicAddress(fake_tunnel(ANNOUNCING), app_served=True)
    client.app.state.public_address = public

    with client:
        client.post("/api/rooms", json=HOST)
        process = public._process

    assert process is not None and process.returncode is not None
