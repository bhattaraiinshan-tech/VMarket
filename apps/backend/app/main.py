import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import (
    APIError,
    error_response,
    handle_api_error,
    handle_http_error,
    handle_validation_error,
)
from app.core.logging import configure_logging, request_id_var
from app.db.session import get_engine

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    if get_engine.cache_info().currsize:
        await get_engine().dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(
        title="Vendor's Market API",
        description="Versioned API for the Vendor's Market commerce platform.",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )
    app.include_router(api_router, prefix="/api/v1")
    app.add_exception_handler(APIError, handle_api_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)

    @app.middleware("http")
    async def attach_request_id(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = uuid4().hex
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        try:
            response: Response
            origin = request.headers.get("origin")
            if (
                request.method in {"POST", "PUT", "PATCH", "DELETE"}
                and origin is not None
                and origin not in settings.cors_origins
            ):
                response = error_response(
                    request,
                    403,
                    "request_origin_not_allowed",
                    "The request origin is not allowed.",
                )
            else:
                response = await call_next(request)
        except Exception as exc:
            response = await handle_unexpected_error(request, exc)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "Unhandled request error",
            extra={
                "error_code": "internal_server_error",
                "request_id": getattr(request.state, "request_id", None),
            },
        )
        return error_response(
            request,
            500,
            "internal_server_error",
            "An unexpected error occurred.",
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "X-VMarket-Workspace",
            "X-VMarket-Shop-Id",
        ],
    )

    return app


app = create_app()
