from typing import Protocol


class VoiceFailed(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SpeechSynthesizer(Protocol):
    async def synthesize(self, text: str) -> bytes: ...

    async def aclose(self) -> None: ...
