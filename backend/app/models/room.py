from typing import Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.models.session import Participant, Person


class Consented(BaseModel):
    model_config = ConfigDict(extra="forbid")

    consent: bool

    @model_validator(mode="after")
    def check_consent(self) -> Self:
        if not self.consent:
            raise ValueError("You must agree before the conversation can start (consent: true).")
        return self


class RoomCreate(Consented):
    host: Person


class RoomJoin(Consented):
    token: str
    guest: Person


class RoomOut(BaseModel):
    room_id: str
    host: Participant
    guest: Participant | None


class RoomCreated(RoomOut):
    host_token: str
    guest_token: str


class RoomJoined(RoomOut):
    token: str
