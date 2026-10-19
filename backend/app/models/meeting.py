from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from app.models.room import Consented
from app.models.session import Person

MAX_TITLE_LENGTH = 120
MAX_AGENDA_LENGTH = 2000
MIN_MINUTES = 5
MAX_MINUTES = 480
LATEST_START = timedelta(days=366)
EARLIEST_START = timedelta(hours=12)

MeetingStatus = Literal["upcoming", "live", "ended"]


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    starts_at: AwareDatetime
    duration_minutes: int = Field(ge=MIN_MINUTES, le=MAX_MINUTES)
    agenda: str = Field(default="", max_length=MAX_AGENDA_LENGTH)
    host_name: str = Field(min_length=1, max_length=40)

    @field_validator("starts_at")
    @classmethod
    def start_must_be_reasonable(cls, value: datetime) -> datetime:
        now = datetime.now(UTC)
        if value < now - EARLIEST_START:
            raise ValueError("The meeting cannot start in the past.")
        if value > now + LATEST_START:
            raise ValueError("The meeting must start within a year.")
        return value


class MeetingOut(BaseModel):
    id: str
    title: str
    starts_at: datetime
    duration_minutes: int
    agenda: str
    host_name: str
    status: MeetingStatus
    people: int


class MeetingHosted(MeetingOut):
    host_token: str
    invite_token: str


class MeetingCreated(MeetingHosted):
    public_url: str | None
    public_url_problem: str | None


class MeetingList(BaseModel):
    meetings: list[MeetingHosted]
    public_url: str | None
    public_url_problem: str | None


class MeetingStart(Consented):
    host: Person


class MeetingJoin(Consented):
    token: str
    guest: Person
