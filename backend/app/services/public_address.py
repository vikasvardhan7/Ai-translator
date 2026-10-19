import asyncio
import logging
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
from collections.abc import Iterator
from pathlib import Path

logger = logging.getLogger(__name__)

TUNNEL_ADDRESS = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
ADDRESS_WAIT_SECONDS = 25.0
STOP_WAIT_SECONDS = 5.0
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
NOT_INSTALLED = (
    "No public link: cloudflared is not installed. Run"
    " winget install --id Cloudflare.cloudflared, then start the backend again."
)
NOT_BUILT = (
    "No public link: the app is not built. In the frontend folder run npm run build,"
    " then start the backend again."
)
DID_NOT_START = "No public link: the tunnel did not start. See the backend window for details."


def _windows_locations() -> Iterator[Path]:
    for variable, parts in (
        ("ProgramFiles(x86)", ("cloudflared", "cloudflared.exe")),
        ("ProgramFiles", ("cloudflared", "cloudflared.exe")),
        ("LOCALAPPDATA", ("Microsoft", "WinGet", "Links", "cloudflared.exe")),
    ):
        root = os.environ.get(variable)
        if root:
            yield Path(root, *parts)
    packages = os.environ.get("LOCALAPPDATA")
    if packages:
        yield from Path(packages, "Microsoft", "WinGet", "Packages").glob("*/cloudflared.exe")
        yield from Path(packages, "Microsoft", "WinGet", "Packages").glob("*/*/cloudflared.exe")


def find_cloudflared(configured: str | None) -> str | None:
    if configured:
        return configured
    found = shutil.which("cloudflared")
    if found:
        return found
    return next((str(path) for path in _windows_locations() if path.is_file()), None)


def _read_output(process: subprocess.Popen[str], found: queue.Queue[str | None]) -> None:
    matched = False
    if process.stdout is not None:
        for line in process.stdout:
            if not matched and (match := TUNNEL_ADDRESS.search(line)):
                matched = True
                found.put(match.group(0))
    if not matched:
        found.put(None)


class PublicAddress:
    def __init__(self, command: list[str] | None, *, app_served: bool) -> None:
        self._command = command
        self._app_served = app_served
        self._process: subprocess.Popen[str] | None = None
        self._address: str | None = None
        self._lock = asyncio.Lock()

    @property
    def problem(self) -> str | None:
        if self._command is None:
            return NOT_INSTALLED
        if not self._app_served:
            return NOT_BUILT
        return None

    async def get(self, local_address: str) -> str | None:
        if self.problem is not None:
            return None
        async with self._lock:
            if self._address is None or self._stopped():
                self._address = await asyncio.to_thread(self._start, local_address)
            return self._address

    async def aclose(self) -> None:
        await asyncio.to_thread(self._stop)

    def _stopped(self) -> bool:
        return self._process is None or self._process.poll() is not None

    def _start(self, local_address: str) -> str | None:
        self._stop()
        try:
            process = subprocess.Popen(
                [*(self._command or []), "tunnel", "--url", local_address],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=NO_WINDOW,
            )
        except OSError as exc:
            logger.warning("The tunnel could not be started: %s", exc)
            return None
        self._process = process
        found: queue.Queue[str | None] = queue.Queue()
        threading.Thread(target=_read_output, args=(process, found), daemon=True).start()
        try:
            address = found.get(timeout=ADDRESS_WAIT_SECONDS)
        except queue.Empty:
            logger.warning("The tunnel gave no public address within %.0f s", ADDRESS_WAIT_SECONDS)
            self._stop()
            return None
        if address is None:
            logger.warning("The tunnel stopped before giving a public address")
            self._stop()
            return None
        logger.info("Public link: %s", address)
        return address

    def _stop(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(STOP_WAIT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
