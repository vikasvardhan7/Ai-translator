from dataclasses import dataclass, field
from typing import Literal, Protocol

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class ChatMessage:
    role: Role
    text: str


@dataclass(frozen=True)
class Said:
    speaker: str
    text: str


@dataclass(frozen=True)
class AppAction:
    name: str
    arguments: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Source:
    title: str
    url: str


@dataclass(frozen=True)
class Reply:
    answer: str
    actions: tuple[AppAction, ...] = ()
    sources: tuple[Source, ...] = ()


class AssistantFailed(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class MeetingAssistant(Protocol):
    async def reply(
        self,
        messages: list[ChatMessage],
        language: str,
        transcript: list[Said],
        actions: list[str],
        now: str | None = None,
    ) -> Reply: ...

    async def aclose(self) -> None: ...
