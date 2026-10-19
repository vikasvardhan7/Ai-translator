from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.languages import invalid_language_message, language_code

MAX_MESSAGES = 30
MAX_MESSAGE_LENGTH = 4000
MAX_LINE_LENGTH = 2000
MAX_LINES = 400
MAX_SPEAKER_LENGTH = 40
MAX_ACTIONS = 40


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class SaidIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    speaker: str = Field(min_length=1, max_length=MAX_SPEAKER_LENGTH)
    text: str = Field(min_length=1, max_length=MAX_LINE_LENGTH)


class AssistantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[MessageIn] = Field(min_length=1, max_length=MAX_MESSAGES)
    language: str
    transcript: list[SaidIn] = Field(default_factory=list, max_length=MAX_LINES)
    actions: list[str] = Field(default_factory=list, max_length=MAX_ACTIONS)

    @field_validator("language")
    @classmethod
    def language_must_be_a_code(cls, value: str) -> str:
        code = language_code(value)
        if code is None:
            raise ValueError(invalid_language_message(value))
        return code

    @model_validator(mode="after")
    def last_message_is_from_the_person(self) -> "AssistantRequest":
        if self.messages[-1].role != "user":
            raise ValueError("The last message must be the person's (role: user).")
        return self


class ActionOut(BaseModel):
    name: str
    arguments: dict[str, str]


class SourceOut(BaseModel):
    title: str
    url: str


class AssistantReply(BaseModel):
    answer: str
    actions: list[ActionOut]
    sources: list[SourceOut]
