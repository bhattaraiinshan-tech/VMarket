import argparse
import asyncio

from sqlalchemy import select

from app.db.session import get_engine, get_session_factory
from app.identity.models import AuditLog, User, UserRole


async def grant_admin(email: str) -> None:
    normalized_email = email.strip().casefold()
    async with get_session_factory()() as session:
        user = await session.scalar(select(User).where(User.email == normalized_email))
        if user is None:
            raise SystemExit("No account exists for that email address.")
        if not user.email_verified or user.account_status != "active":
            raise SystemExit("The account must be active and email-verified before admin access.")

        role = await session.get(UserRole, (user.id, "admin"))
        if role is None:
            session.add(UserRole(user_id=user.id, role="admin"))
            session.add(
                AuditLog(
                    actor_id=None,
                    action="admin_role_granted",
                    target_type="user",
                    target_id=str(user.id),
                    details="Granted through the vmarket-grant-admin operator command.",
                )
            )
            await session.commit()
        print(f"Administrator access is enabled for {normalized_email}.")
    await get_engine().dispose()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Grant administrator access to a verified account."
    )
    parser.add_argument("email", help="Email address of an existing, verified user")
    args = parser.parse_args()
    asyncio.run(grant_admin(args.email))
