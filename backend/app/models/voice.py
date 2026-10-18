from pydantic import BaseModel


class VoiceOut(BaseModel):
    id: str
    display_name: str
    description: str
    gender: str
    language_code: str
    pitch: str
    accent: str


class VoicesOut(BaseModel):
    voices: list[VoiceOut]
