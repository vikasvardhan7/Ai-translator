from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.languages import invalid_language_message, language_code

ParticipantId = Literal["A", "B"]


class Participant(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: ParticipantId
    name: str = Field(min_length=1, max_length=40)
    preferred_language: str

    @field_validator("preferred_language")
    @classmethod
    def language_must_be_a_code(cls, value: str) -> str:
        code = language_code(value)
        if code is None:
            raise ValueError(invalid_language_message(value))
        return code


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consent: bool
    participants: list[Participant] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def check_consent_and_ids(self) -> "SessionCreate":
        if not self.consent:
            raise ValueError("Both people must agree before a session can start (consent: true).")
        if {p.id for p in self.participants} != {"A", "B"}:
            raise ValueError("Participants must have the ids 'A' and 'B', one each.")
        return self


class SessionOut(BaseModel):
    session_id: str
    participants: list[Participant]
    created_at: datetime
