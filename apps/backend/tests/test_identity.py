import re
from collections.abc import AsyncIterator
from typing import TypeAlias
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_session
from app.identity import router as identity_router
from app.identity.models import PlatformOwner, User, UserRole, VendorProfile
from app.identity.security import hash_password, hash_token, verify_password
from app.main import create_app

MailMessage: TypeAlias = tuple[str, str, str]
IdentityClient: TypeAlias = tuple[
    AsyncClient,
    list[MailMessage],
    async_sessionmaker[AsyncSession],
]


@pytest_asyncio.fixture
async def identity_client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[IdentityClient]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    sent_emails: list[MailMessage] = []

    def capture_email(recipient: str, subject: str, body: str) -> None:
        sent_emails.append((recipient, subject, body))

    monkeypatch.setattr(identity_router, "send_identity_email", capture_email)
    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-VMarket-Workspace": "customer"},
    ) as client:
        yield client, sent_emails, factory
    await engine.dispose()


def _email_token(sent_emails: list[MailMessage]) -> str:
    match = re.search(r"#(?:verify|reset)=([^\s]+)", sent_emails[-1][2])
    assert match is not None
    return match.group(1)


async def _register_and_verify(
    client: AsyncClient,
    sent_emails: list[MailMessage],
    email: str,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "a-correct-horse-battery-staple",
            "full_name": "Test Customer",
        },
    )
    assert response.status_code == 201
    assert sent_emails[-1][0] == email.casefold()
    verified = await client.post(
        "/api/v1/auth/verify-email",
        json={"token": _email_token(sent_emails)},
    )
    assert verified.status_code == 200


async def test_password_hashes_are_salted_and_verified() -> None:
    first = hash_password("a-correct-horse-battery-staple")
    second = hash_password("a-correct-horse-battery-staple")

    assert first != second
    assert verify_password("a-correct-horse-battery-staple", first)
    assert not verify_password("wrong-password", first)
    assert not verify_password("wrong-password", "malformed")
    assert hash_token("opaque-token") != "opaque-token"


async def test_login_requires_verified_email_and_registration_is_case_insensitive(
    identity_client: IdentityClient,
) -> None:
    client, sent_emails, _ = identity_client
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "verify@example.com",
            "password": "a-correct-horse-battery-staple",
            "full_name": "Test Customer",
        },
    )
    assert response.status_code == 201
    login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "verify@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert login.status_code == 403
    duplicate = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "VERIFY@example.com",
            "password": "a-correct-horse-battery-staple",
            "full_name": "Duplicate",
        },
    )
    assert duplicate.status_code == 409

    verification = await client.post(
        "/api/v1/auth/verify-email",
        json={"token": _email_token(sent_emails)},
    )
    assert verification.status_code == 200
    verified_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "verify@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert verified_login.status_code == 200
    cookie = verified_login.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=strict" in cookie
    assert "path=/api/v1" in cookie


async def test_register_verify_login_and_isolate_addresses(
    identity_client: IdentityClient,
) -> None:
    client, sent_emails, _ = identity_client
    await _register_and_verify(client, sent_emails, "buyer@example.com")

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "BUYER@example.com", "password": "a-correct-horse-battery-staple"},
    )
    assert login.status_code == 200
    assert login.json()["roles"] == ["customer"]
    assert "vmarket_session" in login.cookies
    profile = await client.get("/api/v1/me")
    assert profile.status_code == 200
    assert profile.json()["profile"]["full_name"] == "Test Customer"

    address = await client.post(
        "/api/v1/me/addresses",
        json={
            "label": "Home",
            "recipient_name": "Test Customer",
            "phone": "+9779800000000",
            "province": "Bagmati",
            "city": "Kathmandu",
            "street_address": "Ward 1",
        },
    )
    assert address.status_code == 201
    assert address.json()["is_default"] is True
    sessions = await client.get("/api/v1/auth/sessions")
    assert sessions.status_code == 200
    assert len(sessions.json()) == 1
    assert sessions.json()[0]["current"] is True

    await client.post("/api/v1/auth/logout")
    assert (await client.get("/api/v1/me")).status_code == 401

    await _register_and_verify(client, sent_emails, "another@example.com")
    second_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "another@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert second_login.status_code == 200
    cross_account_delete = await client.delete(f"/api/v1/me/addresses/{address.json()['id']}")
    assert cross_account_delete.status_code == 404
    assert (await client.get("/api/v1/admin/users")).status_code == 403


async def test_password_recovery_revokes_existing_sessions(
    identity_client: IdentityClient,
) -> None:
    client, sent_emails, _ = identity_client
    await _register_and_verify(client, sent_emails, "recover@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "recover@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert (await client.get("/api/v1/me")).status_code == 200

    response = await client.post(
        "/api/v1/auth/password/forgot",
        json={"email": "recover@example.com"},
    )
    assert response.status_code == 200
    assert sent_emails[-1][1].startswith("Reset your")
    token = _email_token(sent_emails)
    reset = await client.post(
        "/api/v1/auth/password/reset",
        json={"token": token, "password": "a-new-correct-battery-staple"},
    )
    assert reset.status_code == 200
    assert (await client.get("/api/v1/me")).status_code == 401
    assert (
        await client.post(
            "/api/v1/auth/password/reset",
            json={"token": token, "password": "a-new-correct-battery-staple"},
        )
    ).status_code == 400
    old_password = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "recover@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    new_password = await client.post(
        "/api/v1/auth/login",
        json={"email": "recover@example.com", "password": "a-new-correct-battery-staple"},
    )
    assert old_password.status_code == 401
    assert new_password.status_code == 200


async def test_vendor_documents_are_private_and_scoped(
    identity_client: IdentityClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import Mock

    client, sent_emails, _ = identity_client
    storage = Mock()
    storage.presigned_get_object.return_value = "https://private.example/download"
    monkeypatch.setattr(identity_router, "get_minio_client", lambda: storage)

    await _register_and_verify(client, sent_emails, "vendor@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "vendor@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    application = await client.post(
        "/api/v1/vendors/applications",
        json={
            "business_name": "Market Supplies",
            "business_type": "Wholesale",
            "registration_number": "REG-100",
            "business_address": "Kathmandu, Nepal",
        },
    )
    assert application.status_code == 201

    uploaded = await client.post(
        f"/api/v1/vendors/applications/{application.json()['id']}/documents",
        params={"document_type": "business_registration"},
        files={"file": ("registration.pdf", b"%PDF-1.7 document", "application/pdf")},
    )
    assert uploaded.status_code == 201
    assert (
        await client.get(f"/api/v1/admin/vendor-applications/{application.json()['id']}/documents")
    ).status_code == 403
    url = await client.get(
        f"/api/v1/vendors/applications/{application.json()['id']}"
        f"/documents/{uploaded.json()['id']}/url"
    )
    assert url.status_code == 200
    assert url.json()["expires_in_seconds"] == 300
    storage.put_object.assert_called_once()
    assert storage.put_object.call_args.args[0] == "vendor-documents"

    await client.post("/api/v1/auth/logout")
    await _register_and_verify(client, sent_emails, "other-vendor@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "other-vendor@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    forbidden_url = await client.get(
        f"/api/v1/vendors/applications/{application.json()['id']}"
        f"/documents/{uploaded.json()['id']}/url"
    )
    assert forbidden_url.status_code == 404


async def test_admin_review_is_role_protected_and_audited(
    identity_client: IdentityClient,
) -> None:
    client, sent_emails, factory = identity_client
    await _register_and_verify(client, sent_emails, "vendor@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "vendor@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    application = await client.post(
        "/api/v1/vendors/applications",
        json={
            "business_name": "Verified Traders",
            "business_type": "Retail",
            "business_address": "Lalitpur, Nepal",
        },
    )
    assert application.status_code == 201
    vendor_id = application.json()["user_id"]
    await client.post("/api/v1/auth/logout")

    await _register_and_verify(client, sent_emails, "admin@example.com")
    async with factory() as session:
        admin = await session.scalar(select(User).where(User.email == "admin@example.com"))
        assert admin is not None
        session.add(UserRole(user_id=admin.id, role="admin"))
        session.add(PlatformOwner(user_id=admin.id))
        await session.commit()

    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "admin@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    client.headers["X-VMarket-Workspace"] = "admin"
    queue = await client.get("/api/v1/admin/vendor-applications?status=pending")
    assert queue.status_code == 200
    assert queue.json()[0]["email"] == "vendor@example.com"
    decision = await client.post(
        f"/api/v1/admin/vendor-applications/{application.json()['id']}/decision",
        json={"status": "approved"},
    )
    assert decision.status_code == 200
    repeated = await client.post(
        f"/api/v1/admin/vendor-applications/{application.json()['id']}/decision",
        json={"status": "approved"},
    )
    assert repeated.status_code == 409
    logs = await client.get("/api/v1/admin/audit-logs")
    assert logs.status_code == 200
    assert logs.json()[0]["action"] == "vendor_application_approved"

    suspension = await client.post(
        f"/api/v1/admin/users/{vendor_id}/suspension",
        json={"suspended": True, "reason": "Verification concerns require review."},
    )
    assert suspension.status_code == 200
    await client.post("/api/v1/auth/logout")
    suspended_login = await client.post(
        "/api/v1/auth/login",
        json={
            "email": "vendor@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert suspended_login.status_code == 403

    async with factory() as session:
        vendor_role = await session.get(UserRole, (UUID(vendor_id), "vendor"))
        assert vendor_role is not None
        vendor_profile = await session.get(VendorProfile, UUID(vendor_id))
        assert vendor_profile is not None
        assert vendor_profile.business_name == "Verified Traders"


async def test_legacy_admin_role_does_not_grant_owner_access(
    identity_client: IdentityClient,
) -> None:
    client, emails, factory = identity_client
    await _register_and_verify(client, emails, "not-owner@example.com")
    async with factory() as session:
        user = await session.scalar(select(User).where(User.email == "not-owner@example.com"))
        assert user is not None
        session.add(UserRole(user_id=user.id, role="admin"))
        await session.commit()
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "not-owner@example.com", "password": "a-correct-horse-battery-staple"},
    )
    assert login.status_code == 200
    assert login.json()["roles"] == ["customer"]
    client.headers["X-VMarket-Workspace"] = "admin"
    assert (await client.get("/api/v1/admin/users")).status_code == 403


async def test_owner_protection_and_profile_capabilities(identity_client: IdentityClient) -> None:
    client, emails, factory = identity_client
    await _register_and_verify(client, emails, "owner@example.com")
    async with factory() as session:
        user = await session.scalar(select(User).where(User.email == "owner@example.com"))
        assert user is not None
        session.add(PlatformOwner(user_id=user.id))
        await session.commit()
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "a-correct-horse-battery-staple"},
    )
    assert login.status_code == 200
    assert login.json()["roles"] == ["customer", "admin"]
    assert login.json()["vendor_profile"] is None
    deactivation = await client.post(
        "/api/v1/me/deactivate",
        json={"email": "owner@example.com", "password": "a-correct-horse-battery-staple"},
    )
    assert deactivation.status_code == 409
    client.headers["X-VMarket-Workspace"] = "customer"
    assert (await client.get("/api/v1/admin/users")).status_code == 403
    client.headers["X-VMarket-Workspace"] = "admin"
    assert (await client.get("/api/v1/admin/users")).status_code == 200


async def test_owner_bootstrap_is_configured_once_and_idempotent(
    identity_client: IdentityClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.identity import bootstrap_admin

    client, emails, factory = identity_client
    await _register_and_verify(client, emails, "creator@example.com")
    await _register_and_verify(client, emails, "other@example.com")
    settings = SimpleNamespace(owner_email="creator@example.com")
    monkeypatch.setattr(bootstrap_admin, "get_settings", lambda: settings)
    monkeypatch.setattr(bootstrap_admin, "get_session_factory", lambda: factory)
    monkeypatch.setattr(bootstrap_admin, "get_engine", lambda: SimpleNamespace(dispose=AsyncMock()))
    with pytest.raises(SystemExit, match="configured"):
        await bootstrap_admin.grant_admin("other@example.com")
    await bootstrap_admin.grant_admin("CREATOR@example.com")
    await bootstrap_admin.grant_admin("creator@example.com")
    settings.owner_email = "other@example.com"
    with pytest.raises(SystemExit, match="already bound"):
        await bootstrap_admin.grant_admin("other@example.com")
    async with factory() as session:
        owner = await session.get(PlatformOwner, 1)
        creator = await session.scalar(select(User).where(User.email == "creator@example.com"))
        assert owner is not None and creator is not None
        assert owner.user_id == creator.id
