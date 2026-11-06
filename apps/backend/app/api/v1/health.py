import asyncio
import logging

from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from minio.error import S3Error
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from starlette import status
from urllib3.exceptions import HTTPError

from app.core.config import get_settings
from app.db.session import get_engine
from app.identity.models import PlatformOwner, User
from app.storage.client import get_minio_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Check whether the API process is running")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


async def check_database() -> bool:
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except SQLAlchemyError:
        logger.exception("Database readiness check failed", extra={"dependency": "database"})
        return False


def check_minio() -> bool:
    try:
        get_minio_client().list_buckets()
        return True
    except (S3Error, HTTPError, OSError):
        logger.exception("MinIO readiness check failed", extra={"dependency": "minio"})
        return False


async def check_owner() -> bool:
    try:
        async with get_engine().connect() as connection:
            owner_id = await connection.scalar(
                select(PlatformOwner.user_id)
                .join(User, User.id == PlatformOwner.user_id)
                .where(
                    PlatformOwner.id == 1,
                    User.account_status == "active",
                    User.email_verified.is_(True),
                )
            )
        return owner_id is not None
    except SQLAlchemyError:
        logger.exception("Owner readiness check failed", extra={"dependency": "owner"})
        return False


@router.get("/ready", summary="Check whether required services are reachable")
async def readiness() -> JSONResponse:
    database_ready, minio_ready = await asyncio.gather(
        check_database(),
        run_in_threadpool(check_minio),
    )
    dependencies = {
        "database": "ok" if database_ready else "unavailable",
        "minio": "ok" if minio_ready else "unavailable",
    }
    ready = database_ready and minio_ready
    if get_settings().environment in {"staging", "production"}:
        owner_ready = await check_owner()
        dependencies["owner"] = "ok" if owner_ready else "unprovisioned"
        ready = ready and owner_ready
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ok" if ready else "unavailable",
            "dependencies": dependencies,
        },
    )
