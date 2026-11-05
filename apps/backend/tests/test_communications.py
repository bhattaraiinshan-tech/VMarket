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

from app.catalog.models import CatalogCategory, Product, Shop
from app.communications.models import ReviewReport
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import (
    AuditLog,
    AuthSession,
    CustomerProfile,
    User,
    UserRole,
)
from app.identity.security import hash_token
from app.main import create_app
from app.orders.models import (
    CustomerOrder,
    FulfillmentOrder,
    OrderItem,
    OrderNotification,
)

CommunicationsClient: TypeAlias = tuple[
    AsyncClient,
    async_sessionmaker[AsyncSession],
    dict[str, UUID],
]


@pytest_asyncio.fixture
async def communications_client() -> AsyncIterator[CommunicationsClient]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = ("customer", "vendor", "other", "admin")
    tokens = {name: f"communications-{name}-session-token" for name in names}

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    async with factory() as session:
        users: dict[str, User] = {}
        for name in names:
            user = User(
                email=f"{name}@communications.example",
                password_hash="unused",
                email_verified=True,
                account_status="active",
            )
            session.add(user)
            users[name] = user
        await session.flush()
        for name, user in users.items():
            role = "admin" if name == "admin" else "vendor" if name == "vendor" else "customer"
            session.add(UserRole(user_id=user.id, role=role))
            session.add(
                AuthSession(
                    user_id=user.id,
                    token_hash=hash_token(tokens[name]),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                )
            )
            session.add(CustomerProfile(user_id=user.id, full_name=name.title()))
        category = CatalogCategory(name="Home", slug="communications-home")
        session.add(category)
        await session.flush()
        shop = Shop(
            owner_user_id=users["vendor"].id,
            name="Communications Shop",
            slug="communications-shop",
            city="Kathmandu",
            province="Bagmati",
        )
        session.add(shop)
        await session.flush()
        product = Product(
            shop_id=shop.id,
            category_id=category.id,
            name="Test Basket",
            slug="communications-basket",
            description="A basket for endpoint tests.",
            sku="COMM-BASKET",
            price=Decimal("100.00"),
            stock=5,
            attributes={},
            status="approved",
        )
        session.add(product)
        await session.flush()
        order = CustomerOrder(
            customer_id=users["customer"].id,
            order_number="COMM-ORDER-0001",
            invoice_number="COMM-INV-0001",
            idempotency_key="communications-order-idempotency",
            shipping_address={"city": "Kathmandu"},
            status="completed",
            payment_method="cash_on_delivery",
            subtotal=Decimal("100.00"),
            shipping_total=Decimal("0.00"),
            total=Decimal("100.00"),
        )
        session.add(order)
        await session.flush()
        fulfillment = FulfillmentOrder(
            order_id=order.id,
            shop_id=shop.id,
            shop_name=shop.name,
            fulfillment_number="COMM-FUL-0001",
            status="delivered",
            subtotal=Decimal("100.00"),
            shipping_fee=Decimal("0.00"),
        )
        session.add(fulfillment)
        await session.flush()
        item = OrderItem(
            fulfillment_order_id=fulfillment.id,
            product_id=product.id,
            product_name=product.name,
            sku=product.sku,
            quantity=1,
            unit_price=Decimal("100.00"),
            line_total=Decimal("100.00"),
        )
        session.add(item)
        await session.commit()
        ids = {
            "customer": users["customer"].id,
            "vendor": users["vendor"].id,
            "other": users["other"].id,
            "admin": users["admin"].id,
            "shop": shop.id,
            "product": product.id,
            "order": order.id,
            "order_item": item.id,
        }

    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("vmarket_session", tokens["customer"])
        yield client, factory, ids
    await engine.dispose()


def _sign_in(client: AsyncClient, user: str) -> None:
    client.cookies.set("vmarket_session", f"communications-{user}-session-token")


@pytest.mark.asyncio
async def test_conversations_persist_unread_counts_and_enforce_participants(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids = communications_client
    started = await client.post(
        "/api/v1/me/conversations",
        json={"shop_id": str(ids["shop"]), "product_id": str(ids["product"])},
    )
    assert started.status_code == 201
    conversation_id = started.json()["id"]

    sent = await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        json={"content": "Is this basket available?"},
    )
    assert sent.status_code == 201
    assert sent.json()["content"] == "Is this basket available?"

    _sign_in(client, "vendor")
    conversation = await client.get(f"/api/v1/me/conversations/{conversation_id}")
    assert conversation.status_code == 200
    assert conversation.json()["unread_count"] == 1
    messages = await client.get(f"/api/v1/me/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert len(messages.json()) == 1
    conversation = await client.get(f"/api/v1/me/conversations/{conversation_id}")
    assert conversation.json()["unread_count"] == 0

    _sign_in(client, "other")
    forbidden = await client.get(f"/api/v1/me/conversations/{conversation_id}")
    assert forbidden.status_code == 404

    async with factory() as session:
        notification = await session.scalar(
            select(OrderNotification).where(
                OrderNotification.conversation_id == UUID(conversation_id)
            )
        )
        assert notification is not None
        assert notification.user_id == ids["vendor"]
        assert notification.order_id is None


@pytest.mark.asyncio
async def test_reviews_require_delivered_purchase_and_admin_moderation(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids = communications_client
    review_response = await client.post(
        "/api/v1/me/reviews",
        json={
            "order_item_id": str(ids["order_item"]),
            "rating": 5,
            "title": "Good quality",
            "body": "The basket matched the listing.",
        },
    )
    assert review_response.status_code == 201
    review = review_response.json()
    assert review["moderation_status"] == "pending"

    duplicate = await client.post(
        "/api/v1/me/reviews",
        json={
            "order_item_id": str(ids["order_item"]),
            "rating": 4,
            "title": "Another review",
            "body": "A duplicate should not be accepted.",
        },
    )
    assert duplicate.status_code == 409

    published_before_moderation = await client.get(
        f"/api/v1/catalog/products/{ids['product']}/reviews"
    )
    assert published_before_moderation.status_code == 200
    assert published_before_moderation.json() == []

    _sign_in(client, "admin")
    moderated = await client.patch(
        f"/api/v1/admin/reviews/{review['id']}/moderation",
        json={"status": "visible"},
    )
    assert moderated.status_code == 200
    assert moderated.json()["moderation_status"] == "visible"

    _sign_in(client, "vendor")
    response = await client.post(
        f"/api/v1/vendor/reviews/{review['id']}/response",
        json={"response": "Thank you for your review."},
    )
    assert response.status_code == 200
    assert response.json()["vendor_response"] == "Thank you for your review."

    _sign_in(client, "customer")
    public_reviews = await client.get(f"/api/v1/catalog/products/{ids['product']}/reviews")
    assert public_reviews.status_code == 200
    assert len(public_reviews.json()) == 1
    assert public_reviews.json()[0]["product_name"] == "Test Basket"

    _sign_in(client, "other")
    report = await client.post(
        f"/api/v1/me/reviews/{review['id']}/reports",
        json={"reason": "Misleading content", "details": "This was not relevant."},
    )
    assert report.status_code == 201
    assert report.json()["review"]["id"] == review["id"]

    _sign_in(client, "admin")
    moderation = await client.patch(
        f"/api/v1/admin/reviews/{review['id']}/moderation",
        json={"status": "hidden"},
    )
    assert moderation.status_code == 200
    assert moderation.json()["moderation_status"] == "hidden"

    _sign_in(client, "customer")
    hidden_reviews = await client.get(f"/api/v1/catalog/products/{ids['product']}/reviews")
    assert hidden_reviews.status_code == 200
    assert hidden_reviews.json() == []

    async with factory() as session:
        audit = await session.scalar(select(AuditLog).where(AuditLog.target_id == review["id"]))
        assert audit is not None
        assert audit.actor_id == ids["admin"]
        notice = await session.scalar(
            select(OrderNotification).where(
                OrderNotification.user_id == ids["customer"],
                OrderNotification.title == "A vendor responded to your review",
            )
        )
        assert notice is not None
        report_status = await session.scalar(
            select(ReviewReport).where(ReviewReport.review_id == UUID(review["id"]))
        )
        assert report_status is not None
        assert report_status.status == "resolved"


@pytest.mark.asyncio
async def test_support_disputes_are_order_scoped_and_admin_updates_are_audited(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids = communications_client
    valid_dispute = await client.post(
        "/api/v1/me/support-tickets",
        json={
            "kind": "dispute",
            "order_id": str(ids["order"]),
            "subject": "Wrong order",
            "body": "This customer needs assistance with the delivered order.",
        },
    )
    assert valid_dispute.status_code == 201

    _sign_in(client, "other")
    foreign_order = await client.post(
        "/api/v1/me/support-tickets",
        json={
            "kind": "dispute",
            "order_id": str(ids["order"]),
            "subject": "Order dispute",
            "body": "This account should not be able to access this order.",
        },
    )
    assert foreign_order.status_code == 404

    _sign_in(client, "admin")
    tickets = await client.get("/api/v1/admin/support-tickets")
    assert tickets.status_code == 200
    assert len(tickets.json()) == 1
    ticket_id = tickets.json()[0]["id"]
    updated = await client.patch(
        f"/api/v1/admin/support-tickets/{ticket_id}",
        json={"status": "in_progress", "admin_response": "We are investigating."},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"

    async with factory() as session:
        audit = await session.scalar(select(AuditLog).where(AuditLog.target_id == ticket_id))
        assert audit is not None
        assert audit.actor_id == ids["admin"]
        notification = await session.scalar(
            select(OrderNotification).where(
                OrderNotification.user_id == ids["customer"],
                OrderNotification.title == "Support request updated",
            )
        )
        assert notification is not None


@pytest.mark.asyncio
async def test_reviews_are_rejected_before_delivery(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids = communications_client
    async with factory() as session:
        fulfillment = await session.scalar(
            select(FulfillmentOrder).where(FulfillmentOrder.order_id == ids["order"])
        )
        assert fulfillment is not None
        fulfillment.status = "processing"
        await session.commit()

    response = await client.post(
        "/api/v1/me/reviews",
        json={
            "order_item_id": str(ids["order_item"]),
            "rating": 5,
            "title": "Too early",
            "body": "The order has not been delivered.",
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "review_not_eligible"
