import pytest

from app.services import limits
from app.services.limits import Allowance, RateLimiter, TooManyRequests


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    monkeypatch.setattr(limits.time, "monotonic", clock)
    return clock


def test_a_minute_allowance_comes_back_after_a_minute(clock: Clock) -> None:
    limiter = RateLimiter()
    allowance = Allowance(per_minute=2, per_day=100)
    limiter.use("a", allowance)
    limiter.use("a", allowance)
    clock.now += 20

    with pytest.raises(TooManyRequests) as refused:
        limiter.use("a", allowance)

    assert (refused.value.wait_seconds, refused.value.daily) == (40, False)
    clock.now += 40
    limiter.use("a", allowance)
    assert limiter.used_today("a") == 3


def test_a_day_allowance_waits_until_midnight(clock: Clock) -> None:
    limiter = RateLimiter()
    allowance = Allowance(per_minute=100, per_day=1)
    limiter.use("a", allowance)

    with pytest.raises(TooManyRequests) as refused:
        limiter.use("a", allowance)

    assert refused.value.daily
    assert 0 < refused.value.wait_seconds <= 86_400


def test_each_caller_has_its_own_allowance(clock: Clock) -> None:
    limiter = RateLimiter()
    allowance = Allowance(per_minute=1, per_day=1)
    limiter.use("a", allowance)

    limiter.use("b", allowance)

    assert (limiter.used_today("a"), limiter.used_today("b"), limiter.used_today("c")) == (1, 1, 0)


def test_a_new_day_starts_again(clock: Clock, monkeypatch: pytest.MonkeyPatch) -> None:
    limiter = RateLimiter()
    allowance = Allowance(per_minute=10, per_day=1)
    limiter.use("a", allowance)
    tomorrow = limits._today().replace(year=limits._today().year + 1)
    monkeypatch.setattr(limits, "_today", lambda: tomorrow)

    limiter.use("a", allowance)

    assert limiter.used_today("a") == 1


def test_the_number_of_callers_remembered_is_bounded(
    clock: Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(limits, "MAX_TRACKED", 3)
    limiter = RateLimiter()
    allowance = Allowance(per_minute=10, per_day=10)

    for caller in "abcdef":
        limiter.use(caller, allowance)

    assert len(limiter._usage) <= 3
