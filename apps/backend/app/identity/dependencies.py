from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Cookie, Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.catalog.models import Shop
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.models import AuthSession, User
from app.identity.security import hash_token

SESSION_COOKIE = "vmarket_session"
SESSION_DURATION = timedelta(days=7)


@dataclass(frozen=True)
class AuthenticatedUser:
    user: User
    session: AuthSession


Workspace = Literal["customer", "vendor", "admin"]


@dataclass(frozen=True)
class WorkspaceContext:
    user: User
    workspace: Workspace
    shop: Shop | None


def user_capabilities(user: User) -> list[str]:
    return (
        (["customer"] if user.profile is not None else [])
        + (["vendor"] if user.vendor_profile is not None else [])
        + (["admin"] if user.owner_binding is not None else [])
    )


async def get_current_auth(
    session: Annotated[AsyncSession, Depends(get_session)],
    token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> AuthenticatedUser:
    if not token:
        raise APIError(401, "authentication_required", "Please sign in to continue.")

    now = datetime.now(timezone.utc)
    auth_session = await session.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == hash_token(token),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
    )
    if auth_session is None:
        raise APIError(401, "invalid_session", "Your session is invalid or has expired.")

    user = await session.scalar(
        select(User)
        .options(
            selectinload(User.roles),
            selectinload(User.profile),
            selectinload(User.vendor_profile),
            selectinload(User.owner_binding),
        )
        .where(User.id == auth_session.user_id)
    )
    if user is None:
        raise APIError(401, "invalid_session", "Your session is invalid or has expired.")
    if user.account_status != "active":
        raise APIError(403, "account_unavailable", "This account cannot access the platform.")

    last_seen_at = auth_session.last_seen_at
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    if now - last_seen_at > timedelta(minutes=5):
        auth_session.last_seen_at = now
        await session.commit()
    return AuthenticatedUser(user=user, session=auth_session)


async def get_current_user(
    auth: Annotated[AuthenticatedUser, Depends(get_current_auth)],
) -> User:
    if not auth.user.email_verified:
        raise APIError(403, "email_not_verified", "Verify your email address to continue.")
    return auth.user


async def get_current_admin(
    user: Annotated[User, Depends(get_current_user)],
    workspace: Annotated[
        Workspace,
        Header(alias="X-VMarket-Workspace", description="Must be admin for owner operations."),
    ],
) -> User:
    if workspace != "admin" or user.owner_binding is None:
        raise APIError(403, "admin_required", "Administrator access is required.")
    return user


async def resolve_workspace(
    session: AsyncSession,
    user: User,
    workspace: Workspace,
    shop_id: UUID | None,
) -> WorkspaceContext:
    if workspace not in user_capabilities(user):
        raise APIError(403, "workspace_not_allowed", "This workspace is not available.")
    if workspace != "vendor" and shop_id is not None:
        raise APIError(422, "unexpected_shop_context", "Shop selection requires Vendor mode.")
    shop = None
    if shop_id is not None:
        shop = await session.scalar(
            select(Shop).where(Shop.id == shop_id, Shop.owner_user_id == user.id)
        )
        if shop is None:
            raise APIError(404, "shop_not_found", "The selected shop was not found.")
    return WorkspaceContext(user=user, workspace=workspace, shop=shop)


async def get_workspace_context(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
    workspace: Annotated[
        Workspace,
        Header(alias="X-VMarket-Workspace", description="Explicit per-tab workspace selector."),
    ],
    selected_shop_id: Annotated[
        UUID | None,
        Header(alias="X-VMarket-Shop-Id", description="Required for shop-bound Vendor operations."),
    ] = None,
) -> WorkspaceContext:
    return await resolve_workspace(session, user, workspace, selected_shop_id)


async def get_current_customer(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
) -> User:
    if context.workspace != "customer":
        raise APIError(403, "customer_workspace_required", "Switch to Customer mode.")
    return context.user


async def get_current_vendor(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
) -> User:
    if context.workspace != "vendor":
        raise APIError(403, "vendor_workspace_required", "Switch to Vendor mode.")
    return context.user


async def get_selected_shop(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
) -> Shop:
    if context.workspace != "vendor":
        raise APIError(403, "vendor_workspace_required", "Switch to Vendor mode.")
    if context.shop is None:
        raise APIError(422, "shop_context_required", "Select a shop to continue.")
    return context.shop


async def get_active_shop(
    shop: Annotated[Shop, Depends(get_selected_shop)],
) -> Shop:
    if not shop.is_active:
        raise APIError(409, "shop_inactive", "An active vendor shop is required.")
    return shop
