import asyncio
import contextlib
import logging
import os
import re
import shutil
from collections.abc import Iterator
from pathlib import Path

logger = logging.getLogger(__name__)

TUNNEL_ADDRESS = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
ADDRESS_WAIT_SECONDS = 25.0
STOP_WAIT_SECONDS = 5.0
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


class PublicAddress:
    def __init__(self, command: list[str] | None, *, app_served: bool) -> None:
        self._command = command
        self._app_served = app_served
        self._process: asyncio.subprocess.Process | None = None
        self._drainer: asyncio.Task[None] | None = None
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
                self._address = await self._start(local_address)
            return self._address

    async def aclose(self) -> None:
        if self._drainer is not None:
            self._drainer.cancel()
            self._drainer = None
        process = self._process
        self._process = None
        if process is None or process.returncode is not None:
            return
        with contextlib.suppress(ProcessLookupError):
            process.terminate()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(process.wait(), STOP_WAIT_SECONDS)
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()

    def _stopped(self) -> bool:
        return self._process is None or self._process.returncode is not None

    async def _start(self, local_address: str) -> str | None:
        await self.aclose()
        try:
            process = await asyncio.create_subprocess_exec(
                *(self._command or []),
                "tunnel",
                "--url",
                local_address,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except OSError as exc:
            logger.warning("The tunnel could not be started: %s", exc)
            return None
        self._process = process
        if process.stdout is None:
            await self.aclose()
            return None
        try:
            address = await asyncio.wait_for(
                self._read_address(process.stdout), ADDRESS_WAIT_SECONDS
            )
        except TimeoutError:
            logger.warning("The tunnel gave no public address within %.0f s", ADDRESS_WAIT_SECONDS)
            await self.aclose()
            return None
        if address is None:
            logger.warning("The tunnel stopped before giving a public address")
            await self.aclose()
            return None
        logger.info("Public link: %s", address)
        return address

    async def _read_address(self, output: asyncio.StreamReader) -> str | None:
        while line := await output.readline():
            if match := TUNNEL_ADDRESS.search(line.decode("utf-8", "replace")):
                self._drainer = asyncio.create_task(self._drain(output))
                return match.group(0)
        return None

    async def _drain(self, output: asyncio.StreamReader) -> None:
        while await output.readline():
            pass
