from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.languages import invalid_language_message, language_code

MAX_QUESTION_LENGTH = 500
MAX_LINE_LENGTH = 2000
MAX_LINES = 400
MAX_SPEAKER_LENGTH = 40


class SaidIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    speaker: str = Field(min_length=1, max_length=MAX_SPEAKER_LENGTH)
    text: str = Field(min_length=1, max_length=MAX_LINE_LENGTH)


class AssistantQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)
    language: str
    transcript: list[SaidIn] = Field(default_factory=list, max_length=MAX_LINES)

    @field_validator("language")
    @classmethod
    def language_must_be_a_code(cls, value: str) -> str:
        code = language_code(value)
        if code is None:
            raise ValueError(invalid_language_message(value))
        return code


class AssistantAnswer(BaseModel):
    answer: str
