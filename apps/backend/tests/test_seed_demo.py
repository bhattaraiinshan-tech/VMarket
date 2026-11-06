from collections.abc import AsyncIterator
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.catalog.models import CatalogBrand, CatalogCategory, Product, Shop
from app.catalog.seed_demo import (
    DEMO_PASSWORD,
    PRODUCTS,
    VENDORS,
    _ensure_local_development,
    seed_demo_data,
)
from app.core.config import Settings
from app.db.base import Base
from app.identity.models import PlatformOwner, User, UserRole, VendorApplication, VendorProfile
from app.identity.security import verify_password


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
    )
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as db_session:
        yield db_session
    await engine.dispose()


@pytest.mark.asyncio
async def test_demo_seed_is_complete_and_idempotent(session: AsyncSession) -> None:
    async with session.begin():
        await seed_demo_data(session)
    async with session.begin():
        await seed_demo_data(session)

    assert await session.scalar(select(func.count()).select_from(User)) == len(VENDORS)
    assert await session.scalar(select(func.count()).select_from(Shop)) == len(VENDORS)
    assert await session.scalar(select(func.count()).select_from(VendorProfile)) == len(VENDORS)
    assert await session.scalar(select(func.count()).select_from(PlatformOwner)) == 0
    assert await session.scalar(select(func.count()).select_from(Product)) == len(PRODUCTS)
    assert await session.scalar(select(func.count()).select_from(CatalogBrand)) == 5
    assert await session.scalar(select(func.count()).select_from(CatalogCategory)) == len(
        {product.category for product in PRODUCTS}
    )
    assert await session.scalar(
        select(func.count()).select_from(Product).where(Product.status == "approved")
    ) == len(PRODUCTS)

    users = list(await session.scalars(select(User).order_by(User.email)))
    assert all(verify_password(DEMO_PASSWORD, user.password_hash) for user in users)
    assert all(user.email_verified and user.account_status == "active" for user in users)
    assert await session.scalar(
        select(func.count()).select_from(UserRole).where(UserRole.role == "vendor")
    ) == len(VENDORS)
    assert await session.scalar(
        select(func.count())
        .select_from(VendorApplication)
        .where(VendorApplication.status == "approved")
    ) == len(VENDORS)

    first_product = await session.scalar(
        select(Product).where(Product.slug == "demo-handwoven-bamboo-basket-01")
    )
    assert first_product is not None
    assert first_product.price == Decimal("850.00")


def test_demo_seed_refuses_nonlocal_or_non_development_settings() -> None:
    settings = Settings(
        environment="development",
        database_url="postgresql+asyncpg://user:pass@db.example.com:5432/vmarket",
    )
    with pytest.raises(RuntimeError, match="localhost"):
        _ensure_local_development(settings)

    settings.environment = "production"
    with pytest.raises(RuntimeError, match="development"):
        _ensure_local_development(settings)
