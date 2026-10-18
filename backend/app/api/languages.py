from fastapi import APIRouter
from pydantic import BaseModel

from app.core.languages import all_languages

router = APIRouter(prefix="/api", tags=["languages"])


class LanguageOut(BaseModel):
    code: str
    name: str
    native_name: str


class LanguagesOut(BaseModel):
    languages: list[LanguageOut]


@router.get("/languages", response_model=LanguagesOut)
async def list_languages() -> LanguagesOut:
    return LanguagesOut(
        languages=[
            LanguageOut(code=lang.code, name=lang.name, native_name=lang.native_name)
            for lang in all_languages()
        ]
    )
