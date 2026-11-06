import logging
import re
import smtplib
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import (
    SESSION_COOKIE,
    SESSION_DURATION,
    AuthenticatedUser,
    get_current_admin,
    get_current_auth,
    get_current_customer,
    get_current_user,
    user_capabilities,
)
from app.identity.email import send_identity_email
from app.identity.models import (
    AuditLog,
    AuthSession,
    CustomerProfile,
    DeliveryAddress,
    IdentityToken,
    User,
    UserRole,
    VendorApplication,
    VendorDocument,
    VendorProfile,
)
from app.identity.schemas import (
    AccountSuspension,
    AddressCreate,
    AddressRead,
    AdminUserRead,
    AdminVendorApplicationRead,
    AuditLogRead,
    DocumentRead,
    DocumentUrlRead,
    EmailRequest,
    LoginRequest,
    MessageResponse,
    PasswordResetRequest,
    ProfileRead,
    ProfileUpdate,
    RegisterRequest,
    SessionRead,
    TokenRequest,
    UserRead,
    VendorApplicationCreate,
    VendorApplicationRead,
    VendorDecision,
    VendorProfileRead,
)
from app.identity.security import create_opaque_token, hash_password, hash_token, verify_password
from app.storage.client import get_minio_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["identity"])
SESSION_COOKIE_PATH = "/api/v1"
MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
DOCUMENT_TYPES = {"pan_vat", "business_registration", "citizenship"}
DOCUMENT_EXTENSIONS = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
EMAIL_DELIVERY_ERROR = "Email delivery is temporarily unavailable. Please try again later."


def _user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        email_verified=user.email_verified,
        account_status=user.account_status,
        roles=user_capabilities(user),
        profile=ProfileRead.model_validate(user.profile) if user.profile else None,
        vendor_profile=(
            VendorProfileRead.model_validate(user.vendor_profile) if user.vendor_profile else None
        ),
        created_at=user.created_at,
    )


def _audit(
    session: AsyncSession,
    actor_id: UUID | None,
    action: str,
    target_type: str,
    target_id: UUID | str,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            details=details,
        )
    )


async def _issue_identity_token(
    session: AsyncSession,
    user: User,
    purpose: str,
) -> str:
    now = datetime.now(timezone.utc)
    previous_tokens = await session.scalars(
        select(IdentityToken).where(
            IdentityToken.user_id == user.id,
            IdentityToken.purpose == purpose,
            IdentityToken.consumed_at.is_(None),
        )
    )
    for previous in previous_tokens:
        previous.consumed_at = now

    raw_token = create_opaque_token()
    session.add(
        IdentityToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            purpose=purpose,
            expires_at=now
            + (timedelta(hours=24) if purpose == "email_verification" else timedelta(hours=1)),
        )
    )
    return raw_token


async def _deliver_identity_email(
    recipient: str,
    purpose: str,
    raw_token: str,
) -> None:
    settings = get_settings()
    if purpose == "email_verification":
        subject = "Verify your Vendor's Market email"
        link = f"{settings.web_base_url}/#verify={raw_token}"
        body = (
            f"Confirm your email address by opening this link:\n\n{link}\n\n"
            "This link expires in 24 hours."
        )
    else:
        subject = "Reset your Vendor's Market password"
        link = f"{settings.web_base_url}/#reset={raw_token}"
        body = (
            f"Reset your password by opening this link:\n\n{link}\n\nThis link expires in 1 hour."
        )

    try:
        await run_in_threadpool(send_identity_email, recipient, subject, body)
    except (OSError, smtplib.SMTPException):
        logger.error(
            "Identity email delivery failed", extra={"error_code": "email_delivery_failed"}
        )
        raise APIError(503, "email_delivery_unavailable", EMAIL_DELIVERY_ERROR) from None


def _set_session_cookie(response: Response, raw_token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE,
        value=raw_token,
        max_age=int(SESSION_DURATION.total_seconds()),
        httponly=True,
        secure=settings.environment != "development",
        samesite="strict",
        path=SESSION_COOKIE_PATH,
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=get_settings().environment != "development",
        samesite="strict",
        path=SESSION_COOKIE_PATH,
    )


def _address_read(address: DeliveryAddress) -> AddressRead:
    return AddressRead.model_validate(address)


async def _user_application(
    session: AsyncSession,
    user_id: UUID,
    application_id: UUID,
) -> VendorApplication:
    application = await session.scalar(
        select(VendorApplication).where(
            VendorApplication.id == application_id,
            VendorApplication.user_id == user_id,
        )
    )
    if application is None:
        raise APIError(404, "vendor_application_not_found", "Vendor application was not found.")
    return application


async def _document_download_url(
    document: VendorDocument,
) -> DocumentUrlRead:
    try:
        url = await run_in_threadpool(
            get_minio_client().presigned_get_object,
            get_settings().minio_private_bucket,
            document.object_name,
            timedelta(minutes=5),
        )
    except (S3Error, OSError):
        logger.exception("Private vendor document URL could not be created")
        raise APIError(
            503, "document_storage_unavailable", "Document storage is unavailable."
        ) from None
    return DocumentUrlRead(url=url, expires_in_seconds=300)


@router.post(
    "/auth/register",
    response_model=MessageResponse,
    status_code=201,
    summary="Register a customer account",
)
async def register(
    body: RegisterRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    existing = await session.scalar(select(User.id).where(User.email == body.email))
    if existing is not None:
        raise APIError(409, "email_already_registered", "An account already uses this email.")

    password_hash = await run_in_threadpool(hash_password, body.password)
    user = User(email=body.email, password_hash=password_hash)
    user.profile = CustomerProfile(full_name=body.full_name)
    user.roles.append(UserRole(role="customer"))
    session.add(user)
    try:
        await session.flush()
        token = await _issue_identity_token(session, user, "email_verification")
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "email_already_registered", "An account already uses this email."
        ) from None

    await _deliver_identity_email(user.email, "email_verification", token)
    return MessageResponse(message="Check your email to verify your account.")


@router.post("/auth/login", response_model=UserRead, summary="Sign in and create a session")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserRead:
    user = await session.scalar(select(User).where(User.email == body.email))
    if user is None:
        await run_in_threadpool(verify_password, body.password, _DUMMY_PASSWORD_HASH)
        raise APIError(401, "invalid_credentials", "Email or password is incorrect.")
    if not await run_in_threadpool(verify_password, body.password, user.password_hash):
        raise APIError(401, "invalid_credentials", "Email or password is incorrect.")
    if user.account_status != "active":
        raise APIError(403, "account_unavailable", "This account cannot access the platform.")
    if not user.email_verified:
        raise APIError(403, "email_not_verified", "Verify your email address before signing in.")

    now = datetime.now(timezone.utc)
    raw_token = create_opaque_token()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=now + SESSION_DURATION,
        user_agent=request.headers.get("user-agent", "")[:512] or None,
    )
    session.add(auth_session)
    await session.commit()
    await session.refresh(user)
    user = await session.scalar(
        select(User)
        .options(
            selectinload(User.roles),
            selectinload(User.profile),
            selectinload(User.vendor_profile),
            selectinload(User.owner_binding),
        )
        .where(User.id == user.id)
    )
    if user is None:
        raise APIError(500, "account_unavailable", "The account could not be loaded.")
    _set_session_cookie(response, raw_token)
    return _user_read(user)


@router.post("/auth/logout", response_model=MessageResponse, summary="Revoke the current session")
async def logout(
    response: Response,
    auth: Annotated[AuthenticatedUser, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    auth.session.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    _clear_session_cookie(response)
    return MessageResponse(message="You have been signed out.")


@router.post(
    "/auth/verify-email",
    response_model=MessageResponse,
    summary="Verify an email address",
)
async def verify_email(
    body: TokenRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    now = datetime.now(timezone.utc)
    token = await session.scalar(
        select(IdentityToken).where(
            IdentityToken.token_hash == hash_token(body.token),
            IdentityToken.purpose == "email_verification",
            IdentityToken.consumed_at.is_(None),
            IdentityToken.expires_at > now,
        )
    )
    if token is None:
        raise APIError(
            400, "invalid_verification_token", "The verification link is invalid or expired."
        )
    user = await session.get(User, token.user_id)
    if user is None or user.account_status != "active":
        raise APIError(
            400, "invalid_verification_token", "The verification link is invalid or expired."
        )
    token.consumed_at = now
    user.email_verified = True
    await session.commit()
    return MessageResponse(message="Your email address has been verified.")


@router.post(
    "/auth/resend-verification",
    response_model=MessageResponse,
    summary="Resend email verification",
)
async def resend_verification(
    body: EmailRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    user = await session.scalar(
        select(User).where(User.email == body.email, User.account_status == "active")
    )
    if user is not None and not user.email_verified:
        token = await _issue_identity_token(session, user, "email_verification")
        await session.commit()
        await _deliver_identity_email(user.email, "email_verification", token)
    return MessageResponse(message="If the account can be verified, an email has been sent.")


@router.post(
    "/auth/password/forgot",
    response_model=MessageResponse,
    summary="Request a password recovery email",
)
async def forgot_password(
    body: EmailRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    user = await session.scalar(
        select(User).where(
            User.email == body.email,
            User.account_status == "active",
            User.email_verified.is_(True),
        )
    )
    if user is not None:
        token = await _issue_identity_token(session, user, "password_reset")
        await session.commit()
        await _deliver_identity_email(user.email, "password_reset", token)
    return MessageResponse(
        message="If the account exists, password recovery instructions have been sent."
    )


@router.post(
    "/auth/password/reset",
    response_model=MessageResponse,
    summary="Reset a password using a recovery token",
)
async def reset_password(
    body: PasswordResetRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    now = datetime.now(timezone.utc)
    token = await session.scalar(
        select(IdentityToken).where(
            IdentityToken.token_hash == hash_token(body.token),
            IdentityToken.purpose == "password_reset",
            IdentityToken.consumed_at.is_(None),
            IdentityToken.expires_at > now,
        )
    )
    if token is None:
        raise APIError(400, "invalid_reset_token", "The password reset link is invalid or expired.")
    user = await session.get(User, token.user_id)
    if user is None or user.account_status != "active":
        raise APIError(400, "invalid_reset_token", "The password reset link is invalid or expired.")
    user.password_hash = await run_in_threadpool(hash_password, body.password)
    token.consumed_at = now
    sessions = await session.scalars(
        select(AuthSession).where(
            AuthSession.user_id == user.id,
            AuthSession.revoked_at.is_(None),
        )
    )
    for auth_session in sessions:
        auth_session.revoked_at = now
    await session.commit()
    return MessageResponse(message="Your password has been reset. Sign in with your new password.")


@router.get("/auth/sessions", response_model=list[SessionRead], summary="List active sessions")
async def list_sessions(
    auth: Annotated[AuthenticatedUser, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[SessionRead]:
    sessions = await session.scalars(
        select(AuthSession)
        .where(
            AuthSession.user_id == auth.user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
        .order_by(AuthSession.created_at.desc())
    )
    return [
        SessionRead(
            id=item.id,
            created_at=item.created_at,
            last_seen_at=item.last_seen_at,
            expires_at=item.expires_at,
            user_agent=item.user_agent,
            current=item.id == auth.session.id,
        )
        for item in sessions
    ]


@router.delete("/auth/sessions/{session_id}", response_model=MessageResponse)
async def revoke_session(
    session_id: UUID,
    auth: Annotated[AuthenticatedUser, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    target = await session.scalar(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == auth.user.id,
            AuthSession.revoked_at.is_(None),
        )
    )
    if target is None:
        raise APIError(404, "session_not_found", "Session was not found.")
    target.revoked_at = datetime.now(timezone.utc)
    await session.commit()
    return MessageResponse(message="The session has been revoked.")


@router.get("/me", response_model=UserRead, summary="Get the current profile")
async def read_me(user: Annotated[User, Depends(get_current_user)]) -> UserRead:
    return _user_read(user)


@router.patch("/me", response_model=UserRead, summary="Update the current profile")
async def update_me(
    body: ProfileUpdate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserRead:
    if user.profile is None:
        raise APIError(409, "profile_unavailable", "The customer profile is unavailable.")
    if body.full_name is not None:
        user.profile.full_name = body.full_name
    if "phone" in body.model_fields_set:
        user.profile.phone = body.phone
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "phone_already_registered", "This phone number is already in use."
        ) from None
    await session.refresh(user.profile)
    return _user_read(user)


@router.get("/me/addresses", response_model=list[AddressRead], summary="List delivery addresses")
async def list_addresses(
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[AddressRead]:
    addresses = await session.scalars(
        select(DeliveryAddress)
        .where(DeliveryAddress.user_id == user.id)
        .order_by(DeliveryAddress.is_default.desc(), DeliveryAddress.created_at.desc())
    )
    return [_address_read(address) for address in addresses]


@router.post(
    "/me/addresses",
    response_model=AddressRead,
    status_code=201,
    summary="Add a delivery address",
)
async def create_address(
    body: AddressCreate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AddressRead:
    existing = await session.scalar(
        select(DeliveryAddress.id).where(DeliveryAddress.user_id == user.id).limit(1)
    )
    address = DeliveryAddress(
        user_id=user.id,
        **body.model_dump(exclude={"is_default"}),
        is_default=body.is_default or existing is None,
    )
    if address.is_default:
        addresses = await session.scalars(
            select(DeliveryAddress).where(DeliveryAddress.user_id == user.id)
        )
        for current in addresses:
            current.is_default = False
        await session.flush()
    session.add(address)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409,
            "address_update_conflict",
            "The delivery address could not be saved due to a conflicting update.",
        ) from None
    await session.refresh(address)
    return _address_read(address)


@router.put("/me/addresses/{address_id}", response_model=AddressRead)
async def update_address(
    address_id: UUID,
    body: AddressCreate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AddressRead:
    address = await session.scalar(
        select(DeliveryAddress).where(
            DeliveryAddress.id == address_id,
            DeliveryAddress.user_id == user.id,
        )
    )
    if address is None:
        raise APIError(404, "address_not_found", "Delivery address was not found.")
    if body.is_default:
        addresses = await session.scalars(
            select(DeliveryAddress).where(DeliveryAddress.user_id == user.id)
        )
        for current in addresses:
            current.is_default = False
        await session.flush()
    for field, value in body.model_dump().items():
        setattr(address, field, value)
    if address.is_default is False and body.is_default is False:
        has_default = await session.scalar(
            select(DeliveryAddress.id).where(
                DeliveryAddress.user_id == user.id,
                DeliveryAddress.is_default.is_(True),
            )
        )
        if has_default is None:
            fallback = await session.scalar(
                select(DeliveryAddress)
                .where(
                    DeliveryAddress.user_id == user.id,
                    DeliveryAddress.id != address.id,
                )
                .order_by(DeliveryAddress.created_at.asc())
            )
            if fallback is not None:
                fallback.is_default = True
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409,
            "address_update_conflict",
            "The delivery address could not be saved due to a conflicting update.",
        ) from None
    await session.refresh(address)
    return _address_read(address)


@router.delete("/me/addresses/{address_id}", response_model=MessageResponse)
async def delete_address(
    address_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    address = await session.scalar(
        select(DeliveryAddress).where(
            DeliveryAddress.id == address_id,
            DeliveryAddress.user_id == user.id,
        )
    )
    if address is None:
        raise APIError(404, "address_not_found", "Delivery address was not found.")
    was_default = address.is_default
    await session.delete(address)
    await session.flush()
    if was_default:
        next_address = await session.scalar(
            select(DeliveryAddress)
            .where(DeliveryAddress.user_id == user.id)
            .order_by(DeliveryAddress.created_at.asc())
        )
        if next_address is not None:
            next_address.is_default = True
    await session.commit()
    return MessageResponse(message="The delivery address has been deleted.")


@router.get("/me/export", summary="Export personal account data")
async def export_personal_data(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, object]:
    addresses = await session.scalars(
        select(DeliveryAddress).where(DeliveryAddress.user_id == user.id)
    )
    applications = await session.scalars(
        select(VendorApplication).where(VendorApplication.user_id == user.id)
    )
    return {
        "account": {
            "id": str(user.id),
            "email": user.email,
            "email_verified": user.email_verified,
            "created_at": user.created_at.isoformat(),
            "account_status": user.account_status,
        },
        "profile": (
            {"full_name": user.profile.full_name, "phone": user.profile.phone}
            if user.profile
            else None
        ),
        "vendor_profile": (
            {"business_name": user.vendor_profile.business_name} if user.vendor_profile else None
        ),
        "addresses": [
            AddressRead.model_validate(item).model_dump(mode="json") for item in addresses
        ],
        "vendor_applications": [
            VendorApplicationRead.model_validate(item).model_dump(mode="json")
            for item in applications
        ],
    }


@router.post(
    "/me/deactivate", response_model=MessageResponse, summary="Deactivate the current account"
)
async def deactivate_account(
    body: LoginRequest,
    auth: Annotated[AuthenticatedUser, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    response: Response,
) -> MessageResponse:
    if auth.user.owner_binding is not None:
        raise APIError(
            409, "owner_account_protected", "The platform owner account cannot be deactivated."
        )
    if body.email != auth.user.email or not await run_in_threadpool(
        verify_password, body.password, auth.user.password_hash
    ):
        raise APIError(401, "invalid_credentials", "Email or password is incorrect.")
    now = datetime.now(timezone.utc)
    auth.user.account_status = "deactivated"
    auth.user.deactivated_at = now
    active_sessions = await session.scalars(
        select(AuthSession).where(
            AuthSession.user_id == auth.user.id,
            AuthSession.revoked_at.is_(None),
        )
    )
    for auth_session in active_sessions:
        auth_session.revoked_at = now
    _audit(session, auth.user.id, "account_deactivated", "user", auth.user.id)
    await session.commit()
    _clear_session_cookie(response)
    return MessageResponse(message="Your account has been deactivated.")


@router.post(
    "/vendors/applications",
    response_model=VendorApplicationRead,
    status_code=201,
    summary="Apply to become a vendor",
)
async def create_vendor_application(
    body: VendorApplicationCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> VendorApplicationRead:
    existing = await session.scalar(
        select(VendorApplication.id).where(
            VendorApplication.user_id == user.id,
            VendorApplication.status.in_(("pending", "approved")),
        )
    )
    if existing is not None:
        raise APIError(
            409,
            "vendor_application_exists",
            "A pending or approved vendor application already exists.",
        )
    application = VendorApplication(user_id=user.id, **body.model_dump())
    session.add(application)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409,
            "vendor_application_exists",
            "A pending or approved vendor application already exists.",
        ) from None
    await session.refresh(application)
    return VendorApplicationRead.model_validate(application)


@router.get(
    "/vendors/applications/me",
    response_model=list[VendorApplicationRead],
    summary="List the current user's vendor applications",
)
async def list_my_vendor_applications(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[VendorApplicationRead]:
    applications = await session.scalars(
        select(VendorApplication)
        .where(VendorApplication.user_id == user.id)
        .order_by(VendorApplication.submitted_at.desc())
    )
    return [VendorApplicationRead.model_validate(item) for item in applications]


@router.post(
    "/vendors/applications/{application_id}/documents",
    response_model=DocumentRead,
    status_code=201,
    summary="Upload a private vendor verification document",
)
async def upload_vendor_document(
    application_id: UUID,
    document_type: Annotated[str, Query()],
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> DocumentRead:
    if document_type not in DOCUMENT_TYPES:
        raise APIError(
            422, "invalid_document_type", "Choose a supported verification document type."
        )
    application = await _user_application(session, user.id, application_id)
    if application.status != "pending":
        raise APIError(
            409, "application_not_pending", "Documents can only be added to pending applications."
        )

    contents = await file.read(MAX_DOCUMENT_SIZE + 1)
    if not contents or len(contents) > MAX_DOCUMENT_SIZE:
        raise APIError(413, "document_size_invalid", "Documents must be between 1 byte and 10 MB.")
    if contents.startswith(b"%PDF-"):
        content_type = "application/pdf"
    elif contents.startswith(b"\x89PNG\r\n\x1a\n"):
        content_type = "image/png"
    elif contents.startswith(b"\xff\xd8\xff"):
        content_type = "image/jpeg"
    else:
        raise APIError(415, "document_type_unsupported", "Upload a PDF, PNG, or JPEG document.")
    extension = DOCUMENT_EXTENSIONS[content_type]
    original_filename = (
        re.sub(
            r"[\x00-\x1f\x7f]",
            "",
            PurePath((file.filename or "document").replace("\\", "/")).name,
        )[:255]
        or "document"
    )
    object_name = f"vendor-applications/{application.id}/{uuid4().hex}.{extension}"
    settings = get_settings()
    try:
        await run_in_threadpool(
            get_minio_client().put_object,
            settings.minio_private_bucket,
            object_name,
            BytesIO(contents),
            len(contents),
            content_type=content_type,
        )
    except (S3Error, OSError):
        logger.exception("Private vendor document upload failed")
        raise APIError(
            503, "document_storage_unavailable", "Document storage is unavailable."
        ) from None

    document = VendorDocument(
        application_id=application.id,
        document_type=document_type,
        original_filename=original_filename,
        object_name=object_name,
        content_type=content_type,
        file_size=len(contents),
    )
    session.add(document)
    await session.commit()
    await session.refresh(document)
    return DocumentRead.model_validate(document)


@router.get(
    "/vendors/applications/{application_id}/documents",
    response_model=list[DocumentRead],
    summary="List verification documents for the current user's application",
)
async def list_vendor_documents(
    application_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[DocumentRead]:
    application = await _user_application(session, user.id, application_id)
    documents = await session.scalars(
        select(VendorDocument)
        .where(VendorDocument.application_id == application.id)
        .order_by(VendorDocument.uploaded_at.desc())
    )
    return [DocumentRead.model_validate(item) for item in documents]


@router.get(
    "/vendors/applications/{application_id}/documents/{document_id}/url",
    response_model=DocumentUrlRead,
    summary="Get a short-lived URL for an owned verification document",
)
async def vendor_document_url(
    application_id: UUID,
    document_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DocumentUrlRead:
    application = await _user_application(session, user.id, application_id)
    document = await session.scalar(
        select(VendorDocument).where(
            VendorDocument.id == document_id,
            VendorDocument.application_id == application.id,
        )
    )
    if document is None:
        raise APIError(404, "document_not_found", "Verification document was not found.")
    return await _document_download_url(document)


@router.get(
    "/admin/users",
    response_model=list[AdminUserRead],
    summary="List accounts for platform administration",
)
async def admin_list_users(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AdminUserRead]:
    _ = admin
    users = await session.scalars(
        select(User)
        .options(
            selectinload(User.roles),
            selectinload(User.profile),
            selectinload(User.vendor_profile),
            selectinload(User.owner_binding),
        )
        .order_by(User.created_at.desc())
        .limit(limit)
    )
    return [
        AdminUserRead(
            id=user.id,
            email=user.email,
            account_status=user.account_status,
            roles=user_capabilities(user),
            created_at=user.created_at,
        )
        for user in users
    ]


@router.get(
    "/admin/vendor-applications",
    response_model=list[AdminVendorApplicationRead],
    summary="Review vendor applications",
)
async def admin_list_vendor_applications(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: Annotated[
        str | None, Query(alias="status", pattern="^(pending|approved|rejected)$")
    ] = None,
) -> list[AdminVendorApplicationRead]:
    _ = admin
    query = (
        select(VendorApplication, User.email)
        .join(User, User.id == VendorApplication.user_id)
        .order_by(VendorApplication.submitted_at.asc())
    )
    if status_filter:
        query = query.where(VendorApplication.status == status_filter)
    applications = (await session.execute(query)).all()
    return [
        AdminVendorApplicationRead(
            **VendorApplicationRead.model_validate(application).model_dump(),
            email=email,
        )
        for application, email in applications
    ]


@router.get(
    "/admin/vendor-applications/{application_id}/documents",
    response_model=list[DocumentRead],
    summary="List documents submitted with a vendor application",
)
async def admin_list_vendor_documents(
    application_id: UUID,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[DocumentRead]:
    _ = admin
    application = await session.get(VendorApplication, application_id)
    if application is None:
        raise APIError(404, "vendor_application_not_found", "Vendor application was not found.")
    documents = await session.scalars(
        select(VendorDocument)
        .where(VendorDocument.application_id == application.id)
        .order_by(VendorDocument.uploaded_at.desc())
    )
    return [DocumentRead.model_validate(item) for item in documents]


@router.post(
    "/admin/vendor-applications/{application_id}/decision",
    response_model=VendorApplicationRead,
    summary="Approve or reject a vendor application",
)
async def admin_decide_vendor_application(
    application_id: UUID,
    body: VendorDecision,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> VendorApplicationRead:
    application = await session.scalar(
        select(VendorApplication).where(VendorApplication.id == application_id).with_for_update()
    )
    if application is None:
        raise APIError(404, "vendor_application_not_found", "Vendor application was not found.")
    if application.status != "pending":
        raise APIError(
            409, "application_already_reviewed", "Only pending applications can be reviewed."
        )
    applicant = await session.get(User, application.user_id)
    if applicant is None or not applicant.email_verified or applicant.account_status != "active":
        raise APIError(
            409,
            "applicant_unavailable",
            "Only active, email-verified accounts can be reviewed.",
        )
    now = datetime.now(timezone.utc)
    application.status = body.status
    application.review_notes = body.review_notes.strip() if body.review_notes else None
    application.reviewed_by = admin.id
    application.reviewed_at = now
    if body.status == "approved":
        profile = await session.get(VendorProfile, application.user_id)
        if profile is None:
            session.add(
                VendorProfile(user_id=application.user_id, business_name=application.business_name)
            )
        role = await session.get(UserRole, (application.user_id, "vendor"))
        if role is None:
            session.add(UserRole(user_id=application.user_id, role="vendor"))
    _audit(
        session,
        admin.id,
        f"vendor_application_{body.status}",
        "vendor_application",
        application.id,
        application.review_notes,
    )
    await session.commit()
    await session.refresh(application)
    return VendorApplicationRead.model_validate(application)


@router.get(
    "/admin/vendor-applications/{application_id}/documents/{document_id}/url",
    response_model=DocumentUrlRead,
    summary="Get a short-lived URL for a vendor verification document",
)
async def admin_vendor_document_url(
    application_id: UUID,
    document_id: UUID,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DocumentUrlRead:
    document = await session.scalar(
        select(VendorDocument).where(
            VendorDocument.id == document_id,
            VendorDocument.application_id == application_id,
        )
    )
    if document is None:
        raise APIError(404, "document_not_found", "Verification document was not found.")
    _audit(session, admin.id, "vendor_document_accessed", "vendor_document", document.id)
    await session.commit()
    return await _document_download_url(document)


@router.post(
    "/admin/users/{user_id}/suspension",
    response_model=MessageResponse,
    summary="Suspend or reactivate an account",
)
async def admin_set_suspension(
    user_id: UUID,
    body: AccountSuspension,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageResponse:
    if user_id == admin.id:
        raise APIError(
            400, "cannot_suspend_self", "Administrators cannot suspend their own account."
        )
    target = await session.get(User, user_id)
    if target is None:
        raise APIError(404, "user_not_found", "User was not found.")
    if target.account_status == "deactivated":
        raise APIError(409, "account_deactivated", "Deactivated accounts cannot be reactivated.")
    target.account_status = "suspended" if body.suspended else "active"
    if body.suspended:
        now = datetime.now(timezone.utc)
        sessions = await session.scalars(
            select(AuthSession).where(
                AuthSession.user_id == target.id,
                AuthSession.revoked_at.is_(None),
            )
        )
        for auth_session in sessions:
            auth_session.revoked_at = now
    _audit(
        session,
        admin.id,
        "account_suspended" if body.suspended else "account_reactivated",
        "user",
        target.id,
        body.reason.strip(),
    )
    await session.commit()
    return MessageResponse(
        message="The account has been suspended."
        if body.suspended
        else "The account has been reactivated."
    )


@router.get(
    "/admin/audit-logs",
    response_model=list[AuditLogRead],
    summary="Review immutable administrative audit events",
)
async def admin_list_audit_logs(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AuditLogRead]:
    _ = admin
    logs = await session.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit))
    return [AuditLogRead.model_validate(item) for item in logs]


_DUMMY_PASSWORD_HASH = hash_password("this-is-not-a-user-password")
