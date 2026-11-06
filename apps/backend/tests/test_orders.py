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

from app.catalog.models import CatalogCategory, Product, ProductVariant, Shop
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import (
    AuthSession,
    CustomerProfile,
    DeliveryAddress,
    User,
    UserRole,
    VendorProfile,
)
from app.identity.security import hash_token
from app.main import create_app
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

    response = await _place_order(client, ids["address"])
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["subtotal"] == "250.60"
    assert order["shipping_total"] == "200.00"
    assert order["total"] == "450.60"
    assert len(order["fulfillments"]) == 2
    assert {item["shop_name"] for item in order["fulfillments"]} == {"First Shop", "Second Shop"}
    assert all(item["status"] == "pending" for item in order["fulfillments"])

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
