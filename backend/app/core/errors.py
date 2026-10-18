from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _describe(error: dict) -> str:
    location = ".".join(str(part) for part in error["loc"] if part != "body")
    # Pydantic prefixes messages raised in custom validators with "Value error, ".
    message = error["msg"].removeprefix("Value error, ")
    return f"{location}: {message}" if location else message


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        detail = "; ".join(_describe(e) for e in exc.errors())
        return JSONResponse(status_code=422, content={"detail": detail})

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, __: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": "Internal server error."})
