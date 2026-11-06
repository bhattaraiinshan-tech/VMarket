import argparse
import asyncio

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.identity.models import AuditLog, PlatformOwner, User


async def grant_admin(email: str) -> None:
    normalized_email = email.strip().casefold()
    configured_email = get_settings().owner_email
    if configured_email is None or normalized_email != configured_email:
        raise SystemExit("The account must match the configured VMARKET_OWNER_EMAIL.")
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.email == normalized_email))
        if user is None:
            raise SystemExit("No account exists for that email address.")
        if not user.email_verified or user.account_status != "active":
            raise SystemExit("The account must be active and email-verified before admin access.")

        user_id = user.id
        owner = await session.get(PlatformOwner, 1)
        if owner is not None and owner.user_id != user_id:
            raise SystemExit("The platform owner is already bound to another account.")
        if owner is None:
            session.add(PlatformOwner(id=1, user_id=user_id))
            session.add(
                AuditLog(
                    actor_id=None,
                    action="admin_role_granted",
                    target_type="user",
                    target_id=str(user.id),
                    details="Sole owner provisioned through vmarket-grant-admin.",
                )
            )
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                owner = await session.get(PlatformOwner, 1)
                if owner is None:
                    raise
                if owner.user_id != user_id:
                    raise SystemExit("Another owner provisioning operation won the race.") from None
        print("The designated platform owner's administrator access is enabled.")
    await get_engine().dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Provision the sole configured platform owner (not a general role grant)."
    )
    parser.add_argument("email", help="Email address of an existing, verified user")
    args = parser.parse_args()
    asyncio.run(grant_admin(args.email))
