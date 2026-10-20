import math
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime

MAX_TRACKED = 10_000
MINUTE = 60.0


@dataclass
class _Usage:
    minute_start: float
    minute_count: int
    day: date
    day_count: int


@dataclass(frozen=True)
class Allowance:
    per_minute: int
    per_day: int


@dataclass(frozen=True)
class Budget:
    identity: str
    allowance: Allowance


class TooManyRequests(Exception):
    def __init__(self, wait_seconds: int, *, daily: bool) -> None:
        super().__init__()
        self.wait_seconds = wait_seconds
        self.daily = daily


def _today() -> date:
    return datetime.now(UTC).date()


def _seconds_to_midnight() -> int:
    now = datetime.now(UTC)
    return 86_400 - (now.hour * 3600 + now.minute * 60 + now.second)


class RateLimiter:
    def __init__(self) -> None:
        self._usage: dict[str, _Usage] = {}

    def use(self, identity: str, allowance: Allowance) -> None:
        now = time.monotonic()
        today = _today()
        usage = self._usage.get(identity)
        if usage is None:
            if len(self._usage) >= MAX_TRACKED:
                self._forget_old(today)
            usage = self._usage[identity] = _Usage(now, 0, today, 0)
        if now - usage.minute_start >= MINUTE:
            usage.minute_start, usage.minute_count = now, 0
        if usage.day != today:
            usage.day, usage.day_count = today, 0
        if usage.day_count >= allowance.per_day:
            raise TooManyRequests(_seconds_to_midnight(), daily=True)
        if usage.minute_count >= allowance.per_minute:
            wait = max(1, math.ceil(MINUTE - (now - usage.minute_start)))
            raise TooManyRequests(wait, daily=False)
        usage.minute_count += 1
        usage.day_count += 1

    def used_today(self, identity: str) -> int:
        usage = self._usage.get(identity)
        return usage.day_count if usage is not None and usage.day == _today() else 0

    def _forget_old(self, today: date) -> None:
        for identity in [key for key, usage in self._usage.items() if usage.day != today]:
            del self._usage[identity]
        if len(self._usage) >= MAX_TRACKED:
            self._usage.clear()
