from pydantic import BaseModel


class DetectedLanguageOut(BaseModel):
    language: str
    language_name: str
