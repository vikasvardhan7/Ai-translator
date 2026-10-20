import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field

EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s.]+")
CODE = r"^\s*\d{6}\s*$"
MIN_PASSWORD = 8
MAX_PASSWORD = 128


def _email(value: str) -> str:
    cleaned = value.strip().lower()
    if not EMAIL.fullmatch(cleaned):
        raise ValueError("Type a whole email address, such as name@gmail.com.")
    return cleaned


Email = Annotated[str, Field(min_length=3, max_length=254), AfterValidator(_email)]
Password = Annotated[str, Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)]
Code = Annotated[str, Field(pattern=CODE)]
Name = Annotated[
    str,
    BeforeValidator(lambda value: value.strip() if isinstance(value, str) else value),
    Field(min_length=1, max_length=40),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CodeRequest(Strict):
    email: Email
    purpose: Literal["sign_up", "reset"]


class CodeSent(BaseModel):
    sent: bool
    resend_after: int
    expires_in: int


class SignUp(Strict):
    email: Email
    code: Code
    name: Name
    password: Password


class SignIn(Strict):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD)]


class Reset(Strict):
    email: Email
    code: Code
    password: Password


class PasswordChange(Strict):
    current: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD)]
    password: Password


class Rename(Strict):
    name: Name


class Goodbye(Strict):
    password: Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD)]


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    created_at: datetime
    owner: bool
