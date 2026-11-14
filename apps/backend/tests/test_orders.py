from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import TypeAlias
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.catalog.models import CatalogCategory, Product, ProductImage, ProductVariant, Shop
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import (
    AuthSession,
    CustomerProfile,
    DeliveryAddress,
    PlatformOwner,
    User,
    UserRole,
    VendorProfile,
)
from app.identity.security import hash_token
from app.main import create_app
from app.operations.models import FraudReport, PlatformSettings, Promotion
from app.orders.models import (
    CartItem,
    CustomerOrder,
    OrderNotification,
    OrderStatusEvent,
    PaymentTransaction,
)

OrdersClient: TypeAlias = tuple[AsyncClient, async_sessionmaker[AsyncSession], dict[str, UUID]]


@pytest_asyncio.fixture
async def orders_client() -> AsyncIterator[OrdersClient]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    tokens = {name: f"orders-{name}-session-token" for name in ("customer", "vendor1", "vendor2")}

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    async with factory() as session:
        session.add(PlatformSettings(id=1, commission_rate_bps=300, return_window_days=7))
        users: dict[str, User] = {}
        for name in tokens:
            user = User(
                email=f"{name}@orders.example",
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
            if name.startswith("vendor"):
                session.add(UserRole(user_id=user.id, role="vendor"))
                session.add(VendorProfile(user_id=user.id, business_name=name))
            session.add(
                AuthSession(
                    user_id=user.id,
                    token_hash=hash_token(tokens[name]),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                )
            )
        category = CatalogCategory(name="Home", slug="home-orders")
        session.add(category)
        await session.flush()
        shop1 = Shop(
            slot=1,
            owner_user_id=users["vendor1"].id,
            name="First Shop",
            slug="first-shop-orders",
            city="Kathmandu",
            province="Bagmati",
        )
        shop2 = Shop(
            slot=1,
            owner_user_id=users["vendor2"].id,
            name="Second Shop",
            slug="second-shop-orders",
            city="Pokhara",
            province="Gandaki",
        )
        session.add_all([shop1, shop2])
        await session.flush()
        product1 = Product(
            shop_id=shop1.id,
            category_id=category.id,
            name="Woven Basket",
            slug="woven-basket-orders",
            description="A basket.",
            sku="BASKET-ORDERS",
            price=Decimal("100.25"),
            stock=5,
            attributes={},
            status="approved",
        )
        product2 = Product(
            shop_id=shop2.id,
            category_id=category.id,
            name="Clay Cup",
            slug="clay-cup-orders",
            description="A cup.",
            sku="CUP-ORDERS",
            price=Decimal("80.00"),
            stock=0,
            attributes={},
            status="approved",
        )
        session.add_all([product1, product2])
        await session.flush()
        variant = ProductVariant(
            product_id=product2.id,
            name="Blue",
            sku="CUP-ORDERS-BLUE",
            price=Decimal("50.10"),
            stock=4,
            attributes={"color": "blue"},
        )
        address = DeliveryAddress(
            user_id=users["customer"].id,
            label="Home",
            recipient_name="A Customer",
            phone="+977 9800000000",
            province="Bagmati",
            city="Kathmandu",
            area="Ward 1",
            street_address="1 Market Road",
            postal_code="44600",
            is_default=True,
        )
        session.add_all([variant, address])
        await session.commit()
        ids = {
            "customer": users["customer"].id,
            "vendor1": users["vendor1"].id,
            "vendor2": users["vendor2"].id,
            "shop1": shop1.id,
            "shop2": shop2.id,
            "product1": product1.id,
            "product2": product2.id,
            "variant": variant.id,
            "address": address.id,
        }

    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("vmarket_session", tokens["customer"])
        client.headers["X-VMarket-Workspace"] = "customer"
        client.headers["X-Test-Shop-vendor1"] = str(shop1.id)
        client.headers["X-Test-Shop-vendor2"] = str(shop2.id)
        yield client, factory, ids
    await engine.dispose()


def _sign_in(client: AsyncClient, user: str) -> None:
    client.cookies.set("vmarket_session", f"orders-{user}-session-token")
    client.headers.pop("X-VMarket-Shop-Id", None)
    client.headers["X-VMarket-Workspace"] = "vendor" if user.startswith("vendor") else "customer"
    if user.startswith("vendor"):
        client.headers["X-VMarket-Shop-Id"] = client.headers[f"X-Test-Shop-{user}"]


async def test_fraud_reports_require_workspace_and_record_shop(orders_client: OrdersClient) -> None:
    client, factory, ids = orders_client
    body = {
        "target_type": "product",
        "target_id": str(ids["product2"]),
        "reason": "Suspicious product",
    }
    client.headers.pop("X-VMarket-Workspace")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 422
    _sign_in(client, "vendor1")
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 422
    _sign_in(client, "vendor1")
    created = await client.post("/api/v1/me/fraud-reports", json=body)
    assert created.status_code == 201, created.text
    assert created.json()["workspace"] == "vendor"
    assert created.json()["shop_id"] == str(ids["shop1"])
    async with factory() as session:
        saved = await session.get(FraudReport, UUID(created.json()["id"]))
        assert saved is not None and saved.shop_id == ids["shop1"]
        session.add(PlatformOwner(user_id=ids["vendor1"]))
        await session.commit()
    client.headers["X-VMarket-Workspace"] = "admin"
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 403


async def test_fraud_order_target_requires_resource_relationship(
    orders_client: OrdersClient,
) -> None:
    client, _, ids = orders_client
    await client.post(
        "/api/v1/me/cart/items", json={"product_id": str(ids["product1"]), "quantity": 1}
    )
    order = await client.post(
        "/api/v1/me/checkout",
        json={"address_id": str(ids["address"]), "idempotency_key": "fraud-order-request"},
    )
    assert order.status_code == 201, order.text
    body = {"target_type": "order", "target_id": order.json()["id"], "reason": "Order dispute"}
    _sign_in(client, "vendor2")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 404
    _sign_in(client, "vendor1")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 201
    _sign_in(client, "vendor2")
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.post("/api/v1/me/fraud-reports", json=body)).status_code == 404


async def test_vendor_can_disable_only_selected_shop_promotion(orders_client: OrdersClient) -> None:
    client, factory, ids = orders_client
    _sign_in(client, "vendor1")
    promo = await client.post(
        "/api/v1/vendor/promotions",
        json={
            "code": "DISABLE10",
            "title": "Discount",
            "discount_type": "percent",
            "discount_value": "10",
        },
    )
    assert promo.status_code == 201, promo.text
    path = f"/api/v1/vendor/promotions/{promo.json()['id']}"
    _sign_in(client, "vendor2")
    assert (await client.patch(path, json={"is_active": False})).status_code == 404
    _sign_in(client, "customer")
    assert (await client.patch(path, json={"is_active": False})).status_code == 403
    _sign_in(client, "vendor1")
    result = await client.patch(path, json={"is_active": False})
    assert result.status_code == 200, result.text
    assert result.json()["is_active"] is False
    from app.identity.models import AuditLog

    async with factory() as session:
        event = await session.scalar(
            select(AuditLog).where(AuditLog.action == "vendor_promotion_status_updated")
        )
        assert event is not None and event.actor_id == ids["vendor1"]
    _sign_in(client, "customer")
    cart_item = await client.post(
        "/api/v1/me/cart/items",
        json={"product_id": str(ids["product1"]), "quantity": 1},
    )
    assert cart_item.status_code == 201
    _sign_in(client, "vendor1")
    async with factory() as session:
        shop = await session.get(Shop, ids["shop1"])
        assert shop is not None
        shop.is_active = False
        await session.commit()
    inactive_shop_promotion = await client.post(
        "/api/v1/vendor/promotions",
        json={
            "code": "INACTIVE10",
            "title": "Inactive shop discount",
            "discount_type": "percent",
            "discount_value": "10",
        },
    )
    assert inactive_shop_promotion.status_code == 409
    assert inactive_shop_promotion.json()["error"]["code"] == "shop_inactive"
    _sign_in(client, "customer")
    checkout = await client.post(
        "/api/v1/me/checkout",
        json={
            "address_id": str(ids["address"]),
            "idempotency_key": "inactive-shop-checkout",
        },
    )
    assert checkout.status_code == 409
    assert checkout.json()["error"]["code"] == "shop_unavailable"


async def test_vendor_fulfillment_contains_only_delivery_snapshot(
    orders_client: OrdersClient,
) -> None:
    client, _, ids = orders_client
    await client.post(
        "/api/v1/me/cart/items", json={"product_id": str(ids["product1"]), "quantity": 1}
    )
    result = await client.post(
        "/api/v1/me/checkout",
        json={"address_id": str(ids["address"]), "idempotency_key": "delivery-snapshot"},
    )
    assert result.status_code == 201, result.text
    _sign_in(client, "vendor1")
    fulfillment = (await client.get("/api/v1/vendor/orders")).json()["items"][0]
    assert fulfillment["shipping_address"]["recipient_name"] == "A Customer"
    assert fulfillment["shipping_address"]["street_address"] == "1 Market Road"
    assert "label" not in fulfillment["shipping_address"]
    assert "customer_email" not in fulfillment
    _sign_in(client, "vendor2")
    assert (await client.get("/api/v1/vendor/orders")).json()["items"] == []


@pytest.mark.asyncio
async def test_vendor_cannot_buy_own_products_in_either_workspace(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    _sign_in(client, "vendor1")
    assert (await client.get("/api/v1/me/cart")).status_code == 403
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    response = await client.post(
        "/api/v1/me/cart/items", json={"product_id": str(ids["product1"]), "quantity": 1}
    )
    assert response.status_code == 403
    async with factory() as session:
        assert (
            await session.scalar(
                select(func.count()).select_from(CartItem).where(CartItem.user_id == ids["vendor1"])
            )
            == 0
        )
    client.headers.pop("X-VMarket-Workspace")
    assert (await client.get("/api/v1/me/cart")).status_code == 422


@pytest.mark.asyncio
async def test_checkout_rejects_stale_own_shop_cart_before_stock_mutation(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 1)
    async with factory() as session:
        shop = await session.get(Shop, ids["shop1"])
        assert shop is not None
        session.add(VendorProfile(user_id=ids["customer"], business_name="New Owner"))
        await session.flush()
        shop.owner_user_id = ids["customer"]
        await session.commit()
    blocked = await _place_order(client, ids["address"])
    assert blocked.status_code == 403
    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        assert product is not None and product.stock == 5
        assert await session.scalar(select(func.count()).select_from(CustomerOrder)) == 0
        assert await session.scalar(select(func.count()).select_from(PaymentTransaction)) == 0


@pytest.mark.asyncio
async def test_notification_read_and_list_are_isolated_between_owned_shops_and_modes(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    async with factory() as session:
        sibling = Shop(
            owner_user_id=ids["vendor1"],
            slot=2,
            name="Sibling branch",
            slug="sibling-notifications",
            city="Kathmandu",
            province="Bagmati",
        )
        session.add(sibling)
        await session.flush()
        customer_note = OrderNotification(
            user_id=ids["vendor1"],
            workspace="customer",
            title="Personal",
            message="Personal.",
        )
        first_note = OrderNotification(
            user_id=ids["vendor1"],
            workspace="vendor",
            shop_id=ids["shop1"],
            title="First branch",
            message="First.",
        )
        second_note = OrderNotification(
            user_id=ids["vendor1"],
            workspace="vendor",
            shop_id=sibling.id,
            title="Second branch",
            message="Second.",
        )
        account_note = OrderNotification(
            user_id=ids["vendor1"],
            workspace="account",
            title="Account security",
            message="Neutral.",
        )
        session.add_all([customer_note, first_note, second_note, account_note])
        await session.commit()
        sibling_id, customer_id = str(sibling.id), str(customer_note.id)
        first_id, second_id, account_id = (
            str(first_note.id),
            str(second_note.id),
            str(account_note.id),
        )
    _sign_in(client, "vendor1")
    first_inbox = await client.get("/api/v1/me/notifications")
    assert {row["id"] for row in first_inbox.json()} == {first_id, account_id}
    for action in ("read", "unread", "delete"):
        for forbidden_id in (second_id, customer_id):
            rejected = await client.post(
                "/api/v1/me/notifications/batch",
                json={"ids": [first_id, forbidden_id], "action": action},
            )
            assert rejected.status_code == 404
    async with factory() as session:
        unchanged = await session.get(OrderNotification, UUID(first_id))
        assert unchanged is not None and unchanged.read_at is None
    assert (await client.patch(f"/api/v1/me/notifications/{second_id}/read")).status_code == 404
    client.headers["X-VMarket-Shop-Id"] = sibling_id
    second_inbox = await client.get("/api/v1/me/notifications")
    assert {row["id"] for row in second_inbox.json()} == {second_id, account_id}
    assert (await client.patch(f"/api/v1/me/notifications/{customer_id}/read")).status_code == 404
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    personal = await client.get("/api/v1/me/notifications")
    assert {row["id"] for row in personal.json()} == {customer_id, account_id}
    client.headers["X-VMarket-Workspace"] = "vendor"
    assert (await client.get("/api/v1/me/notifications")).status_code == 422
    assert (
        await client.post(
            "/api/v1/me/notifications/batch",
            json={"ids": [first_id], "action": "read"},
        )
    ).status_code == 422


@pytest.mark.parametrize("action", ["read", "unread", "delete"])
async def test_notification_batch_persists_only_selected_rows(
    orders_client: OrdersClient, action: str
) -> None:
    client, factory, ids = orders_client
    async with factory() as session:
        notices = [
            OrderNotification(
                user_id=ids["customer"],
                workspace=workspace,
                title=f"Notice {index}",
                message="An update.",
                read_at=datetime.now(timezone.utc) if action == "unread" else None,
            )
            for index, workspace in enumerate(("customer", "account", "customer"))
        ]
        session.add_all(notices)
        await session.commit()
        selected_ids = [str(item.id) for item in notices[:2]]
        untouched_id = str(notices[2].id)
    response = await client.post(
        "/api/v1/me/notifications/batch", json={"ids": selected_ids, "action": action}
    )
    assert response.status_code == 200, response.text
    persisted = {item["id"]: item for item in (await client.get("/api/v1/me/notifications")).json()}
    assert untouched_id in persisted
    if action == "delete":
        assert response.json() == []
        assert set(persisted) == {untouched_id}
    else:
        assert {item["id"] for item in response.json()} == set(selected_ids)
        assert all(bool(persisted[item]["read_at"]) == (action == "read") for item in selected_ids)
        assert bool(persisted[untouched_id]["read_at"]) == (action == "unread")
        repeated = await client.post(
            "/api/v1/me/notifications/batch", json={"ids": selected_ids, "action": action}
        )
        assert repeated.json() == response.json()


async def test_notification_batch_rejects_other_accounts_and_invalid_payloads(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    async with factory() as session:
        own = OrderNotification(
            user_id=ids["customer"], workspace="customer", title="Own", message="Own."
        )
        other = OrderNotification(
            user_id=ids["vendor1"], workspace="account", title="Other", message="Other."
        )
        session.add_all([own, other])
        await session.commit()
        own_id, other_id = str(own.id), str(other.id)
    for action in ("read", "unread", "delete"):
        result = await client.post(
            "/api/v1/me/notifications/batch",
            json={"ids": [own_id, other_id], "action": action},
        )
        assert result.status_code == 404
    for body in (
        {"ids": [], "action": "read"},
        {"ids": [own_id, own_id], "action": "read"},
        {"ids": [str(UUID(int=index)) for index in range(1, 102)], "action": "read"},
        {"ids": ["not-a-uuid"], "action": "read"},
        {"ids": [own_id], "action": "invalid"},
        {"ids": [own_id], "action": "read", "workspace": "admin"},
    ):
        assert (await client.post("/api/v1/me/notifications/batch", json=body)).status_code == 422
    async with factory() as session:
        unchanged = await session.get(OrderNotification, UUID(own_id))
        assert unchanged is not None and unchanged.read_at is None
    client.headers.pop("X-VMarket-Workspace")
    body = {"ids": [own_id], "action": "read"}
    assert (await client.post("/api/v1/me/notifications/batch", json=body)).status_code == 422
    client.headers["X-VMarket-Workspace"] = "customer"
    client.cookies.clear()
    assert (await client.post("/api/v1/me/notifications/batch", json=body)).status_code == 401


async def test_notification_batch_accepts_the_full_inbox_limit(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    async with factory() as session:
        notifications = [
            OrderNotification(
                user_id=ids["customer"],
                workspace="customer",
                title=f"Notice {index}",
                message="An update.",
            )
            for index in range(100)
        ]
        session.add_all(notifications)
        await session.commit()
        selected = [str(item.id) for item in notifications]
    response = await client.post(
        "/api/v1/me/notifications/batch", json={"ids": selected, "action": "read"}
    )
    assert response.status_code == 200
    assert len(response.json()) == 100
    assert all(item["read_at"] is not None for item in response.json())
    persisted = await client.get("/api/v1/me/notifications")
    assert len(persisted.json()) == 100
    assert all(item["read_at"] is not None for item in persisted.json())


async def _add_cart_item(
    client: AsyncClient, product_id: UUID, quantity: int, variant_id: UUID | None = None
) -> None:
    response = await client.post(
        "/api/v1/me/cart/items",
        json={
            "product_id": str(product_id),
            "variant_id": str(variant_id) if variant_id else None,
            "quantity": quantity,
        },
    )
    assert response.status_code == 201, response.text


async def _place_order(
    client: AsyncClient, address_id: UUID, key: str = "checkout-request-key-001"
):
    return await client.post(
        "/api/v1/me/checkout",
        json={
            "address_id": str(address_id),
            "payment_method": "cash_on_delivery",
            "idempotency_key": key,
        },
    )


@pytest.mark.asyncio
async def test_cart_items_expose_primary_product_image(orders_client: OrdersClient) -> None:
    client, factory, ids = orders_client
    async with factory() as session:
        session.add_all(
            [
                ProductImage(
                    product_id=ids["product1"],
                    object_name="products/basket-back.jpg",
                    alt_text="Basket back",
                    sort_order=1,
                ),
                ProductImage(
                    product_id=ids["product1"],
                    object_name="products/basket front.jpg",
                    alt_text="",
                    sort_order=0,
                ),
            ]
        )
        await session.commit()
    await _add_cart_item(client, ids["product1"], 1)

    item = (await client.get("/api/v1/me/cart")).json()["items"][0]

    assert item["image_url"].endswith("/products/basket%20front.jpg")
    assert item["image_alt"] == "Woven Basket"


@pytest.mark.asyncio
async def test_order_history_images_preserve_purchase_snapshots(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 1)
    await _add_cart_item(client, ids["product2"], 1, ids["variant"])
    placed = await _place_order(client, ids["address"])
    assert placed.status_code == 201
    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        assert product is not None
        product.name = "Renamed Basket"
        product.price = Decimal("999.00")
        session.add_all(
            [
                ProductImage(
                    product_id=ids["product1"],
                    object_name="products/back.jpg",
                    alt_text="Back",
                    sort_order=1,
                ),
                ProductImage(
                    product_id=ids["product1"],
                    object_name="products/front image.jpg",
                    alt_text="",
                    sort_order=0,
                ),
            ]
        )
        await session.commit()
    response = await client.get("/api/v1/me/orders")
    assert response.status_code == 200
    items = {
        item["product_name"]: item
        for shipment in response.json()[0]["fulfillments"]
        for item in shipment["items"]
    }
    assert items["Woven Basket"]["image_url"].endswith("/products/front%20image.jpg")
    assert items["Woven Basket"]["image_alt"] == "Woven Basket"
    assert items["Woven Basket"]["unit_price"] == "100.25"
    assert items["Clay Cup"]["image_url"] is None
    assert items["Clay Cup"]["variant_name"] == "Blue"
    _sign_in(client, "vendor1")
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.get("/api/v1/me/orders")).json() == []
    assert (
        await client.get(f"/api/v1/me/orders/{placed.json()['id']}")
    ).status_code == 404


@pytest.mark.asyncio
async def test_checkout_splits_vendor_orders_reserves_stock_and_is_idempotent(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 1)
    merged = await client.post(
        "/api/v1/me/cart/items",
        json={"product_id": str(ids["product1"]), "quantity": 1},
    )
    assert merged.status_code == 201
    await _add_cart_item(client, ids["product2"], 1, ids["variant"])
    cart = await client.get("/api/v1/me/cart")
    assert cart.status_code == 200
    assert cart.json()["item_count"] == 3
    assert cart.json()["subtotal"] == "250.60"
    cart_items = {item["sku"]: item for item in cart.json()["items"]}
    basket, cup = cart_items["BASKET-ORDERS"], cart_items["CUP-ORDERS-BLUE"]
    assert basket["sku"] == "BASKET-ORDERS"
    assert basket["product_slug"] == "woven-basket-orders"
    assert basket["image_url"] is None
    assert basket["image_alt"] == "Woven Basket"
    assert cup["sku"] == "CUP-ORDERS-BLUE"

    response = await _place_order(client, ids["address"])
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["subtotal"] == "250.60"
    assert order["shipping_total"] == "200.00"
    assert order["total"] == "450.60"
    assert len(order["fulfillments"]) == 2
    assert {item["shop_name"] for item in order["fulfillments"]} == {"First Shop", "Second Shop"}
    assert all(item["status"] == "pending" for item in order["fulfillments"])
    assert all(item["delivery_feedback"] is None for item in order["fulfillments"])
    assert all(item["courier_name"] is None for item in order["fulfillments"])

    repeated = await _place_order(client, ids["address"])
    assert repeated.status_code == 201
    assert repeated.json()["id"] == order["id"]
    assert (await client.get("/api/v1/me/cart")).json()["items"] == []

    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        variant = await session.get(ProductVariant, ids["variant"])
        assert product is not None and product.stock == 3
        assert variant is not None and variant.stock == 3
        assert await session.scalar(select(func.count()).select_from(CartItem)) == 0
        assert await session.scalar(select(func.count()).select_from(CustomerOrder)) == 1
        assert await session.scalar(select(func.count()).select_from(OrderNotification)) == 3
        payments = list(await session.scalars(select(PaymentTransaction)))
        assert len(payments) == 2
        assert {payment.status for payment in payments} == {"pending"}

    invoice = await client.get(f"/api/v1/me/orders/{order['id']}/invoice")
    assert invoice.status_code == 200
    assert invoice.json()["invoice_number"] == order["invoice_number"]
    assert invoice.json()["total"] == "450.60"


@pytest.mark.asyncio
async def test_vendor_promotion_is_shop_scoped_and_snapshots_discount_and_commission(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    _sign_in(client, "vendor1")
    created = await client.post(
        "/api/v1/vendor/promotions",
        json={
            "code": "spring10",
            "title": "Spring discount",
            "discount_type": "percent",
            "discount_value": "10",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["code"] == "SPRING10"
    assert created.json()["sponsor_type"] == "vendor"
    assert created.json()["shop_id"] == str(ids["shop1"])

    _sign_in(client, "customer")
    await _add_cart_item(client, ids["product1"], 1)
    response = await client.post(
        "/api/v1/me/checkout",
        json={
            "address_id": str(ids["address"]),
            "payment_method": "cash_on_delivery",
            "idempotency_key": "vendor-promotion-checkout-01",
            "promotion_code": "spring10",
        },
    )
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["discount_total"] == "10.03"
    assert order["total"] == "190.22"
    assert order["promotion_code"] == "SPRING10"
    fulfillment = order["fulfillments"][0]
    assert fulfillment["discount_total"] == "10.03"
    assert fulfillment["commission_rate_bps"] == 300
    assert fulfillment["commission_amount"] == "2.71"
    assert fulfillment["transactions"][0]["amount"] == "190.22"

    repeated = await client.post(
        "/api/v1/me/checkout",
        json={
            "address_id": str(ids["address"]),
            "payment_method": "cash_on_delivery",
            "idempotency_key": "vendor-promotion-checkout-01",
            "promotion_code": "SPRING10",
        },
    )
    assert repeated.status_code == 201
    assert repeated.json()["id"] == order["id"]
    async with factory() as session:
        promotion = await session.get(Promotion, UUID(created.json()["id"]))
        assert promotion is not None and promotion.redemption_count == 1
        session.add(PlatformOwner(user_id=ids["customer"]))
        await session.commit()
    client.headers["X-VMarket-Workspace"] = "admin"
    admin_orders = await client.get("/api/v1/admin/orders")
    admin_payments = await client.get("/api/v1/admin/payments")
    assert admin_orders.status_code == 200, admin_orders.text
    assert admin_orders.json()[0]["promotion_code"] == "SPRING10"
    assert admin_payments.status_code == 200, admin_payments.text
    assert admin_payments.json()[0]["amount"] == "190.22"


@pytest.mark.asyncio
async def test_operations_settings_dashboard_and_fraud_reports_are_owner_protected_and_audited(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    assert (await client.get("/api/v1/admin/dashboard")).status_code == 403
    async with factory() as session:
        session.add(PlatformOwner(user_id=ids["customer"]))
        await session.commit()

    client.headers["X-VMarket-Workspace"] = "admin"
    dashboard = await client.get("/api/v1/admin/dashboard")
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["users_total"] == 3
    settings = await client.patch(
        "/api/v1/admin/settings",
        json={"commission_rate_bps": 450, "return_window_days": 14},
    )
    assert settings.status_code == 200, settings.text
    assert settings.json()["commission_rate_bps"] == 450
    assert settings.json()["return_window_days"] == 14
    platform_promotion = await client.post(
        "/api/v1/admin/promotions",
        json={
            "code": "PLATFORM5",
            "title": "Marketplace offer",
            "discount_type": "fixed",
            "discount_value": "5.00",
        },
    )
    assert platform_promotion.status_code == 201, platform_promotion.text
    assert platform_promotion.json()["sponsor_type"] == "platform"
    invalid_settings = await client.patch(
        "/api/v1/admin/settings", json={"commission_rate_bps": 600}
    )
    assert invalid_settings.status_code == 422

    client.headers["X-VMarket-Workspace"] = "customer"
    report = await client.post(
        "/api/v1/me/fraud-reports",
        json={
            "target_type": "product",
            "target_id": str(ids["product1"]),
            "reason": "Suspicious listing",
            "details": "The seller appears to be impersonating a brand.",
        },
    )
    assert report.status_code == 201, report.text
    duplicate = await client.post(
        "/api/v1/me/fraud-reports",
        json={
            "target_type": "product",
            "target_id": str(ids["product1"]),
            "reason": "Suspicious listing",
        },
    )
    assert duplicate.status_code == 409

    client.headers["X-VMarket-Workspace"] = "admin"
    queued = await client.get("/api/v1/admin/fraud-reports?status=pending")
    assert queued.status_code == 200
    assert len(queued.json()) == 1
    resolved = await client.patch(
        f"/api/v1/admin/fraud-reports/{report.json()['id']}",
        json={
            "status": "resolved",
            "investigation_notes": "Verified the listing and contacted the reporter.",
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"
    audits = await client.get("/api/v1/admin/audit-logs")
    assert any(item["action"] == "fraud_report_investigated" for item in audits.json())


@pytest.mark.asyncio
async def test_checkout_rejects_stale_stock_without_partial_reservation(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 2)
    await _add_cart_item(client, ids["product2"], 1, ids["variant"])
    async with factory() as session:
        variant = await session.get(ProductVariant, ids["variant"])
        assert variant is not None
        variant.stock = 0
        await session.commit()

    response = await _place_order(client, ids["address"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "insufficient_stock"
    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        assert product is not None and product.stock == 5
        assert await session.scalar(select(func.count()).select_from(CustomerOrder)) == 0
        assert await session.scalar(select(func.count()).select_from(CartItem)) == 2


@pytest.mark.asyncio
async def test_products_with_variants_require_a_selected_option(
    orders_client: OrdersClient,
) -> None:
    client, _, ids = orders_client
    response = await client.post(
        "/api/v1/me/cart/items",
        json={"product_id": str(ids["product2"]), "quantity": 1},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "variant_required"


@pytest.mark.asyncio
async def test_vendor_scoped_fulfillment_transitions_tracking_returns_and_cod_refund(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 2)
    placed = await _place_order(client, ids["address"])
    assert placed.status_code == 201
    fulfillment = placed.json()["fulfillments"][0]
    fulfillment_id = fulfillment["id"]

    _sign_in(client, "vendor2")
    own_orders = await client.get("/api/v1/vendor/orders")
    assert own_orders.status_code == 200
    assert own_orders.json()["items"] == []
    cross_shop = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
        json={"status": "confirmed"},
    )
    assert cross_shop.status_code == 404

    _sign_in(client, "vendor1")
    for status in ("confirmed", "processing"):
        changed = await client.patch(
            f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
            json={"status": status},
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["status"] == status
    missing_tracking = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
        json={"status": "shipped"},
    )
    assert missing_tracking.status_code == 422
    shipped = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
        json={"status": "shipped", "tracking_number": "NP-TRACK-123"},
    )
    assert shipped.status_code == 200
    assert shipped.json()["tracking_number"] == "NP-TRACK-123"
    delivered = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
        json={"status": "delivered", "cash_collected": True},
    )
    assert delivered.status_code == 200
    assert delivered.json()["transactions"][0]["status"] == "collected"

    _sign_in(client, "customer")
    customer_order = await client.get(f"/api/v1/me/orders/{placed.json()['id']}")
    assert customer_order.status_code == 200
    assert customer_order.json()["status"] == "completed"
    return_requested = await client.post(f"/api/v1/me/fulfillment-orders/{fulfillment_id}/returns")
    assert return_requested.status_code == 200
    assert return_requested.json()["status"] == "return_requested"

    _sign_in(client, "vendor1")
    vendor_notifications = await client.get("/api/v1/me/notifications")
    assert any(
        notification["title"] == "Return requested" for notification in vendor_notifications.json()
    )
    returned = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
        json={"status": "returned", "note": "Condition checked."},
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "returned"
    assert any(
        transaction["transaction_type"] == "refund" and transaction["status"] == "refund_due"
        for transaction in returned.json()["transactions"]
    )
    refunded = await client.post(f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/refund")
    assert refunded.status_code == 200
    assert any(
        transaction["transaction_type"] == "refund" and transaction["status"] == "refunded"
        for transaction in refunded.json()["transactions"]
    )
    _sign_in(client, "customer")
    customer_notifications = await client.get("/api/v1/me/notifications")
    refund_notification = next(
        item for item in customer_notifications.json() if item["title"] == "Cash refund recorded"
    )
    marked_read = await client.patch(f"/api/v1/me/notifications/{refund_notification['id']}/read")
    assert marked_read.status_code == 200
    assert marked_read.json()["read_at"] is not None
    _sign_in(client, "vendor2")
    hidden_notification = await client.patch(
        f"/api/v1/me/notifications/{refund_notification['id']}/read"
    )
    assert hidden_notification.status_code == 404
    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        assert product is not None and product.stock == 5
        charge = await session.scalar(
            select(PaymentTransaction).where(PaymentTransaction.transaction_type == "charge")
        )
        assert charge is not None and charge.status == "collected"
        events = list(
            await session.scalars(
                select(OrderStatusEvent).where(
                    OrderStatusEvent.fulfillment_order_id == UUID(fulfillment_id)
                )
            )
        )
        assert {event.to_status for event in events} == {
            "pending",
            "confirmed",
            "processing",
            "shipped",
            "delivered",
            "return_requested",
            "returned",
        }


@pytest.mark.asyncio
async def test_customer_cancellation_restocks_and_order_isolation(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    await _add_cart_item(client, ids["product1"], 2)
    placed = await _place_order(client, ids["address"])
    fulfillment_id = placed.json()["fulfillments"][0]["id"]

    _sign_in(client, "vendor2")
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    hidden = await client.get(f"/api/v1/me/orders/{placed.json()['id']}")
    assert hidden.status_code == 404

    _sign_in(client, "customer")
    cancelled = await client.post(f"/api/v1/me/fulfillment-orders/{fulfillment_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    async with factory() as session:
        product = await session.get(Product, ids["product1"])
        assert product is not None and product.stock == 5
        payment = await session.scalar(select(PaymentTransaction))
        assert payment is not None and payment.status == "cancelled"
