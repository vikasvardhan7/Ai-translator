import logging
import re
from asyncio import sleep
from collections.abc import Awaitable, Callable

import httpx
from google.genai import errors

logger = logging.getLogger(__name__)

HTTP_TOO_MANY_REQUESTS = 429
QUICK_WAIT_SECONDS = 0.5
MAX_WAIT_SECONDS = 2.0
DELAY = re.compile(r"(\d+(?:\.\d+)?)s")


def _suggested_wait(details: object) -> float | None:
    if isinstance(details, dict):
        delay = details.get("retryDelay")
        if isinstance(delay, str) and (match := DELAY.fullmatch(delay)):
            return float(match.group(1))
        values = list(details.values())
    elif isinstance(details, list):
        values = details
    else:
        return None
    for value in values:
        if (found := _suggested_wait(value)) is not None:
            return found
    return None


def wait_before_retry(exc: Exception) -> float | None:
    if isinstance(exc, errors.APIError) and exc.code == HTTP_TOO_MANY_REQUESTS:
        suggested = _suggested_wait(exc.details)
        wait = QUICK_WAIT_SECONDS if suggested is None else suggested
        return wait if wait <= MAX_WAIT_SECONDS else None
    if isinstance(exc, (errors.ServerError, httpx.ConnectError)):
        return QUICK_WAIT_SECONDS
    return None


async def with_one_retry[T](call: Callable[[], Awaitable[T]]) -> T:
    try:
        return await call()
    except (errors.APIError, httpx.HTTPError) as exc:
        wait = wait_before_retry(exc)
        if wait is None:
            raise
        logger.info("Gemini was busy; trying once more in %.1f s", wait)
    await sleep(wait)
    return await call()
