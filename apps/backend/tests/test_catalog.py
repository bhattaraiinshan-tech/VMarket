from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import TypeAlias
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.catalog.models import Product, Shop
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import (
    AuditLog,
    AuthSession,
    CustomerProfile,
    PlatformOwner,
    User,
    UserRole,
    VendorApplication,
    VendorProfile,
)
from app.identity.security import hash_token
from app.main import create_app

CatalogClient: TypeAlias = tuple[AsyncClient, async_sessionmaker[AsyncSession], dict[str, UUID]]


@pytest_asyncio.fixture
async def catalog_client() -> AsyncIterator[CatalogClient]:
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

    tokens = {
        name: f"catalog-{name}-session-token" for name in ("admin", "vendor", "other", "customer")
    }
    async with factory() as session:
        users: dict[str, User] = {}
        for name in tokens:
            user = User(
                email=f"{name}@example.com",
                password_hash="unused",
                email_verified=True,
                account_status="active",
            )
            session.add(user)
            users[name] = user
        await session.flush()
        for name, user in users.items():
            session.add(UserRole(user_id=user.id, role="customer"))
            session.add(CustomerProfile(user_id=user.id, full_name=name))
            if name == "admin":
                session.add(PlatformOwner(user_id=user.id))
            if name in {"admin", "vendor", "other"}:
                session.add(
                    UserRole(user_id=user.id, role="admin" if name == "admin" else "vendor")
                )
            session.add(
                AuthSession(
                    user_id=user.id,
                    token_hash=hash_token(tokens[name]),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                )
            )
        for name in ("vendor", "other"):
            session.add(VendorProfile(user_id=users[name].id, business_name=name))
            session.add(
                VendorApplication(
                    user_id=users[name].id,
                    business_name=f"{name.title()} Market",
                    business_type="Retail",
                    business_address="Kathmandu, Nepal",
                    status="approved",
                )
            )
        await session.commit()
        user_ids = {name: user.id for name, user in users.items()}

    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client, factory, user_ids
    await engine.dispose()


async def _sign_in(client: AsyncClient, token: str) -> None:
    client.cookies.set("vmarket_session", token)
    name = token.split("-")[1]
    client.headers.pop("X-VMarket-Shop-Id", None)
    client.headers["X-VMarket-Workspace"] = (
        "admin" if name == "admin" else "customer" if name == "customer" else "vendor"
    )
    if name in {"vendor", "other"}:
        shops = await client.get("/api/v1/vendor/shops")
        assert shops.status_code == 200
        if shops.json():
            client.headers["X-VMarket-Shop-Id"] = shops.json()[0]["id"]


@pytest.mark.asyncio
async def test_catalogue_moderation_discovery_and_wishlist(
    catalog_client: CatalogClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from unittest.mock import Mock

    from app.catalog import router as catalog_router

    client, factory, _ = catalog_client
    storage = Mock()
    monkeypatch.setattr(catalog_router, "get_minio_client", lambda: storage)

    await _sign_in(client, "catalog-admin-session-token")
    category_response = await client.post(
        "/api/v1/admin/catalog/categories",
        json={"name": "Home & Living"},
    )
    assert category_response.status_code == 201
    parent_category_id = category_response.json()["id"]
    subcategory = await client.post(
        "/api/v1/admin/catalog/categories",
        json={"name": "Kitchen & Dining", "parent_id": parent_category_id},
    )
    assert subcategory.status_code == 201
    category_id = subcategory.json()["id"]
    assert subcategory.json()["parent_id"] == parent_category_id
    attribute = await client.post(
        f"/api/v1/admin/catalog/categories/{category_id}/attributes",
        json={
            "key": "material",
            "label": "Material",
            "value_type": "text",
            "required": True,
        },
    )
    assert attribute.status_code == 201
    variant_attribute = await client.post(
        f"/api/v1/admin/catalog/categories/{category_id}/attributes",
        json={
            "key": "color",
            "label": "Color",
            "value_type": "text",
            "applies_to_variant": True,
        },
    )
    assert variant_attribute.status_code == 201
    brand = await client.post(
        "/api/v1/admin/catalog/brands",
        json={"name": "Mountain Works"},
    )
    assert brand.status_code == 201

    await _sign_in(client, "catalog-vendor-session-token")
    shop_response = await client.post(
        "/api/v1/vendor/shop",
        json={
            "name": "Kathmandu Home Store",
            "description": "Locally made home goods.",
            "city": "Kathmandu",
            "province": "Bagmati",
            "latitude": "27.7172",
            "longitude": "85.3240",
        },
    )
    assert shop_response.status_code == 201
    shop_id = shop_response.json()["id"]
    client.headers["X-VMarket-Shop-Id"] = shop_id
    assert shop_response.json()["slug"].startswith("kathmandu-home-store-")
    assert shop_response.json()["latitude"] == "27.717200"

    product_body = {
        "category_id": category_id,
        "brand_id": brand.json()["id"],
        "name": "Handwoven Basket",
        "description": "A sturdy basket woven in Nepal.",
        "sku": "basket-001",
        "price": "1200.50",
        "stock": 0,
        "attributes": {"material": "bamboo"},
    }
    missing_attribute = await client.post(
        "/api/v1/vendor/products",
        json={**product_body, "attributes": {}},
    )
    assert missing_attribute.status_code == 422
    created = await client.post("/api/v1/vendor/products", json=product_body)
    assert created.status_code == 201
    product = created.json()
    assert product["status"] == "pending"
    assert product["price"] == "1200.50"
    visible_baskets = (await client.get("/api/v1/catalog/products", params={"q": "basket"})).json()[
        "items"
    ]
    assert all(item["id"] != product["id"] for item in visible_baskets)

    variant = await client.post(
        f"/api/v1/vendor/products/{product['id']}/variants",
        json={
            "name": "Black",
            "sku": "basket-001-black",
            "price": "1250.00",
            "stock": 3,
            "attributes": {"color": "Black"},
        },
    )
    assert variant.status_code == 201
    updated_variant = await client.patch(
        f"/api/v1/vendor/products/{product['id']}/variants/{variant.json()['id']}",
        json={"stock": 3},
    )
    assert updated_variant.status_code == 200

    invalid_image = await client.post(
        f"/api/v1/vendor/products/{product['id']}/images",
        files={"file": ("basket.png", b"not a png", "image/png")},
    )
    assert invalid_image.status_code == 415

    uploaded = await client.post(
        f"/api/v1/vendor/products/{product['id']}/images",
        params={"alt_text": "Woven basket"},
        files={"file": ("basket.png", b"\x89PNG\r\n\x1a\nimage-data", "image/png")},
    )
    assert uploaded.status_code == 201
    assert f"/product-media/products/{product['id']}/" in uploaded.json()["url"]
    assert storage.put_object.call_args.args[0] == "product-media"

    tray = await client.post(
        "/api/v1/vendor/products",
        json={
            **product_body,
            "name": "Woven Tray",
            "sku": "tray-001",
            "stock": 4,
        },
    )
    assert tray.status_code == 201
    tray_variant = await client.post(
        f"/api/v1/vendor/products/{tray.json()['id']}/variants",
        json={
            "name": "Natural",
            "sku": "tray-001-natural",
            "price": "1200.50",
            "stock": 0,
            "attributes": {"color": "Natural"},
        },
    )
    assert tray_variant.status_code == 201

    await _sign_in(client, "catalog-admin-session-token")
    pending = await client.get("/api/v1/admin/catalog/moderation")
    assert pending.status_code == 200
    assert {item["id"] for item in pending.json()["items"]} == {
        product["id"],
        tray.json()["id"],
    }
    for pending_product in (product, tray.json()):
        decision = await client.post(
            f"/api/v1/admin/catalog/products/{pending_product['id']}/moderation",
            json={"status": "approved"},
        )
        assert decision.status_code == 200

    await _sign_in(client, "catalog-vendor-session-token")
    updated_product = await client.patch(
        f"/api/v1/vendor/products/{product['id']}",
        json={"price": "1200.75"},
    )
    assert updated_product.status_code == 200
    assert updated_product.json()["status"] == "pending"
    visible_baskets = (await client.get("/api/v1/catalog/products", params={"q": "basket"})).json()[
        "items"
    ]
    assert all(item["id"] != product["id"] for item in visible_baskets)
    await _sign_in(client, "catalog-admin-session-token")
    resubmitted = await client.post(
        f"/api/v1/admin/catalog/products/{product['id']}/moderation",
        json={"status": "approved"},
    )
    assert resubmitted.status_code == 200

    discovery = await client.get(
        "/api/v1/catalog/products",
        params={
            "q": "basket",
            "category_id": category_id,
            "brand_id": brand.json()["id"],
            "city": "Kathmandu",
            "min_price": "1000",
            "max_price": "1300",
            "in_stock": "true",
            "sort": "price_asc",
        },
    )
    assert discovery.status_code == 200
    assert discovery.json()["total"] == 1
    assert discovery.json()["items"][0]["available"] is True
    assert discovery.json()["items"][0]["images"][0]["alt_text"] == "Woven basket"
    unavailable = await client.get(
        "/api/v1/catalog/products",
        params={"q": "tray", "in_stock": "true"},
    )
    assert unavailable.json()["total"] == 0
    tray_details = await client.get(f"/api/v1/catalog/products/{tray.json()['slug']}")
    assert tray_details.json()["available"] is False

    nearby = await client.get(
        "/api/v1/shops",
        params={"latitude": "27.7172", "longitude": "85.3240", "radius_km": 5},
    )
    assert nearby.status_code == 200
    assert nearby.json()[0]["id"] == shop_id
    assert nearby.json()[0]["distance_km"] == 0

    await _sign_in(client, "catalog-other-session-token")
    outsider_shop = await client.post(
        "/api/v1/vendor/shop",
        json={
            "name": "Other Home Store",
            "city": "Pokhara",
            "province": "Gandaki",
        },
    )
    assert outsider_shop.status_code == 201
    client.headers["X-VMarket-Shop-Id"] = outsider_shop.json()["id"]
    unauthorized = await client.patch(
        f"/api/v1/vendor/products/{product['id']}",
        json={"price": "1.00"},
    )
    assert unauthorized.status_code == 404

    await _sign_in(client, "catalog-vendor-session-token")
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id", None)
    assert (await client.post(f"/api/v1/me/wishlist/{product['id']}")).status_code == 204
    assert (await client.post(f"/api/v1/me/wishlist/{product['id']}")).status_code == 204
    wishlist = await client.get("/api/v1/me/wishlist")
    assert wishlist.status_code == 200
    assert len(wishlist.json()) == 1
    assert (await client.delete(f"/api/v1/me/wishlist/{product['id']}")).status_code == 204
    assert (await client.get("/api/v1/me/wishlist")).json() == []

    async with factory() as session:
        persisted = await session.get(Product, UUID(product["id"]))
        assert persisted is not None
        assert persisted.status == "approved"
        assert isinstance(persisted.price, Decimal)
        logs = list(
            (
                await session.scalars(
                    select(AuditLog).where(AuditLog.action == "catalog_product_approved")
                )
            ).all()
        )
        assert len(logs) == 3

    await _sign_in(client, "catalog-vendor-session-token")
    stock_update = await client.patch(
        f"/api/v1/vendor/products/{product['id']}",
        json={"stock": 12},
    )
    assert stock_update.status_code == 200
    assert stock_update.json()["status"] == "approved"
    variant_stock_update = await client.patch(
        f"/api/v1/vendor/products/{product['id']}/variants/{variant.json()['id']}",
        json={"stock": 9},
    )
    assert variant_stock_update.status_code == 200
    async with factory() as session:
        shop = await session.get(Shop, UUID(shop_id))
        assert shop is not None
        shop.is_active = False
        await session.commit()
    inactive_shop_product = await client.post("/api/v1/vendor/products", json=product_body)
    assert inactive_shop_product.status_code == 409
    assert inactive_shop_product.json()["error"]["code"] == "shop_inactive"


@pytest.mark.asyncio
async def test_catalogue_requires_vendor_approval_and_valid_location(
    catalog_client: CatalogClient,
) -> None:
    client, _, _ = catalog_client
    await _sign_in(client, "catalog-vendor-session-token")
    assert (
        await client.get(
            "/api/v1/shops",
            params={"latitude": "27.7"},
        )
    ).status_code == 422
    await _sign_in(client, "catalog-customer-session-token")
    assert (
        await client.post(
            "/api/v1/vendor/shop",
            json={
                "name": "Unapproved Shop",
                "city": "Kathmandu",
                "province": "Bagmati",
            },
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_three_shop_limit_and_explicit_shop_authorization(
    catalog_client: CatalogClient,
) -> None:
    client, factory, _ = catalog_client
    await _sign_in(client, "catalog-vendor-session-token")
    shop_ids: list[str] = []
    for index in range(3):
        created = await client.post(
            "/api/v1/vendor/shops",
            json={"name": f"Shop {index}", "city": "Kathmandu", "province": "Bagmati"},
        )
        assert created.status_code == 201, created.text
        shop_ids.append(created.json()["id"])
    from app.catalog.models import Shop

    async with factory() as session:
        shop = await session.get(Shop, UUID(shop_ids[0]))
        assert shop is not None
        shop.is_active = False
        await session.commit()
    fourth = await client.post(
        "/api/v1/vendor/shops",
        json={"name": "Fourth Shop", "city": "Kathmandu", "province": "Bagmati"},
    )
    assert fourth.status_code == 409
    assert fourth.json()["error"]["code"] == "shop_limit_reached"
    assert len((await client.get("/api/v1/vendor/shops")).json()) == 3
    assert (await client.get("/api/v1/vendor/shop")).status_code == 422
    client.headers["X-VMarket-Shop-Id"] = shop_ids[1]
    assert (await client.get("/api/v1/vendor/shop")).json()["id"] == shop_ids[1]
    changed = await client.patch(
        f"/api/v1/vendor/shops/{shop_ids[1]}", json={"name": "Renamed selected branch"}
    )
    assert changed.status_code == 200
    assert changed.json()["name"] == "Renamed selected branch"
    assert (await client.get(f"/api/v1/vendor/shops/{shop_ids[2]}")).status_code == 404
    assert (
        await client.patch(f"/api/v1/vendor/shops/{shop_ids[2]}", json={"name": "Wrong branch"})
    ).status_code == 404
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.get("/api/v1/vendor/shop")).status_code == 403
    client.headers.pop("X-VMarket-Workspace")
    assert (await client.get("/api/v1/me/wishlist")).status_code == 422
    await _sign_in(client, "catalog-other-session-token")
    client.headers["X-VMarket-Shop-Id"] = shop_ids[1]
    assert (await client.get("/api/v1/vendor/products")).status_code == 404
