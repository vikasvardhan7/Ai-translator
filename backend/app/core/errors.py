from collections.abc import Iterable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

PYDANTIC_VALUE_ERROR_PREFIX = "Value error, "


def _describe(error: dict[str, Any]) -> str:
    location = ".".join(str(part) for part in error["loc"] if part != "body")
    message = error["msg"].removeprefix(PYDANTIC_VALUE_ERROR_PREFIX)
    return f"{location}: {message}" if location else message


def describe_errors(errors: Iterable[dict[str, Any]]) -> str:
    return "; ".join(_describe(error) for error in errors)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": describe_errors(exc.errors())})

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})
