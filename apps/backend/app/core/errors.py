from collections.abc import Mapping
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: Any = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or request_id_var.get()
    response_headers = {"X-Request-ID": request_id} if request_id else {}
    if headers:
        response_headers.update(headers)
    content = {
        "error": {"code": code, "message": message, "details": details},
        "request_id": request_id,
    }
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(content),
        headers=response_headers,
    )


async def handle_api_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, APIError):
        raise TypeError("API error handler received an unexpected exception type")
    return error_response(
        request,
        exc.status_code,
        exc.code,
        exc.message,
        exc.details,
    )


async def handle_http_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        raise TypeError("HTTP error handler received an unexpected exception type")
    message = str(exc.detail) if exc.status_code < 500 else "The request could not be completed."
    return error_response(
        request,
        exc.status_code,
        "http_error",
        message,
        headers=exc.headers,
    )


async def handle_validation_error(
    request: Request,
    exc: Exception,
) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise TypeError("Validation error handler received an unexpected exception type")
    details = [
        {"location": error["loc"], "message": error["msg"], "type": error["type"]}
        for error in exc.errors()
    ]
    return error_response(
        request,
        422,
        "validation_error",
        "The request contains invalid data.",
        details,
    )
