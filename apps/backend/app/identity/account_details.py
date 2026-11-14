"""Role-aware account settings and private avatar storage."""

import logging
import warnings
from io import BytesIO
from typing import Annotated, Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from minio.error import S3Error
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import WorkspaceContext, get_current_user, get_workspace_context
from app.identity.models import AccountDetails, User
from app.identity.schemas import AccountDetailsRead, AccountDetailsUpdate
from app.storage.client import get_minio_client

router = APIRouter(tags=["identity"])
logger = logging.getLogger(__name__)
MAX_AVATAR_SIZE = 2 * 1024 * 1024
MAX_AVATAR_PIXELS = 20_000_000
FORMATS = {
    "PNG": ("image/png", "png"),
    "JPEG": ("image/jpeg", "jpg"),
    "WEBP": ("image/webp", "webp"),
}
CUSTOMER_FIELDS = {"preferred_categories"}
VENDOR_FIELDS = {
    "business_category",
    "registration_number",
    "payout_preference",
    "business_description",
}
REQUIRED_FIELDS = {
    "first_name",
    "last_name",
    "preferred_categories",
    "communication_email",
    "communication_sms",
}


def _check_context(context: WorkspaceContext) -> None:
    if context.workspace not in ("customer", "vendor"):
        raise APIError(403, "workspace_not_allowed", "Select Customer or Vendor mode.")


async def _details(
    session: AsyncSession, user: User, *, create: bool = False
) -> AccountDetails | None:
    if create:
        # Serialize first-write creation and concurrent updates for this account.
        await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    details = await session.get(AccountDetails, user.id)
    if details is None and create:
        details = AccountDetails(
            user_id=user.id,
            preferred_categories=[],
            communication_email=False,
            communication_sms=False,
        )
        session.add(details)
    return details


def _read(context: WorkspaceContext, details: AccountDetails | None) -> AccountDetailsRead:
    user = context.user
    workspace = cast(Literal["customer", "vendor"], context.workspace)
    first = (
        details.first_name
        if details and details.first_name is not None
        else (user.profile.full_name if user.profile else "")
    )
    last = details.last_name if details and details.last_name is not None else ""
    avatar_url = (
        "/api/v1/me/account-details/avatar/content"
        if details and details.avatar_object_name
        else None
    )
    vendor = workspace == "vendor"
    return AccountDetailsRead(
        workspace=workspace,
        first_name=first,
        last_name=last,
        email=user.email,
        email_verified=user.email_verified,
        phone=user.profile.phone if user.profile else (details.phone if details else None),
        avatar_url=avatar_url,
        preferred_categories=(details.preferred_categories if details and not vendor else []),
        communication_email=details.communication_email if details else False,
        communication_sms=details.communication_sms if details else False,
        business_name=user.vendor_profile.business_name if vendor and user.vendor_profile else None,
        business_category=details.business_category if details and vendor else None,
        registration_number=details.registration_number if details and vendor else None,
        payout_preference=cast(
            Literal["manual", "bank_transfer"] | None,
            details.payout_preference if details and vendor else None,
        ),
        business_description=details.business_description if details and vendor else None,
    )


@router.get("/me/account-details", response_model=AccountDetailsRead)
async def read_account_details(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountDetailsRead:
    _check_context(context)
    return _read(context, await _details(session, context.user))


@router.patch("/me/account-details", response_model=AccountDetailsRead)
async def update_account_details(
    body: AccountDetailsUpdate,
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountDetailsRead:
    _check_context(context)
    fields = body.model_fields_set
    if fields & (VENDOR_FIELDS if context.workspace == "customer" else CUSTOMER_FIELDS):
        raise APIError(403, "field_not_allowed", "This field is not available in this workspace.")
    if any(getattr(body, name) is None for name in fields & REQUIRED_FIELDS):
        raise APIError(422, "field_required", "This field cannot be null.")
    if "first_name" in fields and not body.first_name:
        raise APIError(422, "invalid_name", "First name cannot be blank.")
    if not fields:
        return _read(context, await _details(session, context.user))
    user = context.user
    details = await _details(session, user, create=True)
    assert details is not None
    if user.profile:
        await session.refresh(user.profile)
    current = _read(context, details)
    first = body.first_name if "first_name" in fields else current.first_name
    last = body.last_name if "last_name" in fields else current.last_name
    if fields & {"first_name", "last_name"}:
        full_name = " ".join(part for part in (first, last) if part).strip()
        if not full_name or len(full_name) > 120:
            raise APIError(422, "invalid_name", "Full name must be between 1 and 120 characters.")
        details.first_name, details.last_name = first, last
        if user.profile:
            user.profile.full_name = full_name
    if "phone" in fields:
        if user.profile:
            user.profile.phone = body.phone
        else:
            details.phone = body.phone
    for name in fields - {"first_name", "last_name", "phone"}:
        setattr(details, name, getattr(body, name))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "phone_already_registered", "This phone number is already in use."
        ) from None
    return _read(context, details)


def _image_type(contents: bytes) -> tuple[str, str]:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(contents)) as image:
                if image.format not in FORMATS or image.width * image.height > MAX_AVATAR_PIXELS:
                    raise ValueError("Unsupported image")
                result = FORMATS[image.format]
                image.verify()
            with Image.open(BytesIO(contents)) as image:
                image.load()
        return result
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise APIError(
            415, "avatar_type_unsupported", "Upload a valid PNG, JPEG, or WebP image."
        ) from None


async def _remove_avatar(object_name: str | None) -> None:
    if not object_name:
        return
    try:
        await run_in_threadpool(
            get_minio_client().remove_object, get_settings().minio_private_bucket, object_name
        )
    except (S3Error, OSError):
        logger.exception("Could not remove obsolete avatar object")


@router.post("/me/account-details/avatar", response_model=AccountDetailsRead)
async def upload_account_avatar(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> AccountDetailsRead:
    _check_context(context)
    contents = await file.read(MAX_AVATAR_SIZE + 1)
    if not contents or len(contents) > MAX_AVATAR_SIZE:
        raise APIError(413, "avatar_size_invalid", "Avatar must be between 1 byte and 2 MiB.")
    content_type, extension = _image_type(contents)
    object_name = f"account-avatars/{context.user.id}/{uuid4().hex}.{extension}"
    try:
        await run_in_threadpool(
            get_minio_client().put_object,
            get_settings().minio_private_bucket,
            object_name,
            BytesIO(contents),
            len(contents),
            content_type=content_type,
        )
    except (S3Error, OSError):
        raise APIError(
            503, "avatar_storage_unavailable", "Avatar storage is unavailable."
        ) from None
    try:
        details = await _details(session, context.user, create=True)
        assert details is not None
        old_object = details.avatar_object_name
        details.avatar_object_name = object_name
        details.avatar_content_type = content_type
        await session.commit()
    except Exception:
        await session.rollback()
        await _remove_avatar(object_name)
        raise
    await _remove_avatar(old_object)
    return _read(context, details)


@router.delete("/me/account-details/avatar", response_model=AccountDetailsRead)
async def delete_account_avatar(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AccountDetailsRead:
    _check_context(context)
    details = await _details(session, context.user, create=True)
    assert details is not None
    old_object = details.avatar_object_name
    details.avatar_object_name = details.avatar_content_type = None
    await session.commit()
    await _remove_avatar(old_object)
    return _read(context, details)


@router.get("/me/account-details/avatar/content", name="read_account_avatar")
async def read_account_avatar(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    if user.profile is None and user.vendor_profile is None:
        raise APIError(403, "workspace_not_allowed", "No account profile is available.")
    details = await _details(session, user)
    if details is None or not details.avatar_object_name or not details.avatar_content_type:
        raise APIError(404, "avatar_not_found", "Avatar was not found.")
    object_name = details.avatar_object_name

    def fetch() -> bytes:
        response = get_minio_client().get_object(get_settings().minio_private_bucket, object_name)
        try:
            return response.read(MAX_AVATAR_SIZE + 1)
        finally:
            response.close()
            response.release_conn()

    try:
        contents = await run_in_threadpool(fetch)
    except (S3Error, OSError):
        raise APIError(
            503, "avatar_storage_unavailable", "Avatar storage is unavailable."
        ) from None
    return Response(
        content=contents,
        media_type=details.avatar_content_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
