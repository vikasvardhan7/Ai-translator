from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Said:
    speaker: str
    text: str


class AssistantFailed(Exception):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class MeetingAssistant(Protocol):
    async def answer(self, question: str, language: str, transcript: list[Said]) -> str: ...

    async def aclose(self) -> None: ...
