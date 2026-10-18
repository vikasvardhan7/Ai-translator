from dataclasses import dataclass
from typing import Protocol


class VoiceFailed(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class VoiceOption:
    id: str
    display_name: str
    description: str
    gender: str
    language_code: str
    pitch: str
    accent: str


class SpeechSynthesizer(Protocol):
    async def synthesize(self, text: str, voice: str | None = None) -> bytes: ...

    async def list_voices(self) -> list[VoiceOption]: ...

    async def aclose(self) -> None: ...
