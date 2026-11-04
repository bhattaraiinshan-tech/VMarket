from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Cookie, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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
        .options(selectinload(User.roles), selectinload(User.profile))
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
) -> User:
    if not any(role.role == "admin" for role in user.roles):
        raise APIError(403, "admin_required", "Administrator access is required.")
    return user
