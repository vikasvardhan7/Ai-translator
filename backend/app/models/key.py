from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

MIN_DAILY_LIMIT = 10
MAX_DAILY_LIMIT = 100_000


class KeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=60)
    daily_limit: int = Field(default=1000, ge=MIN_DAILY_LIMIT, le=MAX_DAILY_LIMIT)


class KeyOut(BaseModel):
    id: str
    name: str
    shown: str
    daily_limit: int
    used_today: int
    created_at: datetime
    last_used_at: datetime | None


class KeyCreated(BaseModel):
    key: KeyOut
    secret: str


class KeyList(BaseModel):
    keys: list[KeyOut]
    public_url: str | None
    public_url_problem: str | None
