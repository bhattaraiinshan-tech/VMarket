from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import TypeAlias
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from starlette.testclient import TestClient, WebSocketDisconnect

import app.communications.router as communications_router
from app.catalog.models import CatalogCategory, Product, Shop
from app.communications.models import ConversationMessage, ReviewReport
from app.communications.router import connections
from app.communications.schemas import MessageRead
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import (
    AuditLog,
    AuthSession,
    CustomerProfile,
    PlatformOwner,
    User,
    UserRole,
    VendorProfile,
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
    FastAPI,
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
            if name in {"vendor", "other"}:
                session.add(VendorProfile(user_id=user.id, business_name="Communications Vendor"))
            if name == "admin":
                session.add(PlatformOwner(id=1, user_id=user.id))
            session.add(
                AuthSession(
                    user_id=user.id,
                    token_hash=hash_token(tokens[name]),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                )
            )
            session.add(CustomerProfile(user_id=user.id, full_name=name.title()))
        session.add(UserRole(user_id=users["other"].id, role="admin"))
        category = CatalogCategory(name="Home", slug="communications-home")
        session.add(category)
        await session.flush()
        shop = Shop(
            owner_user_id=users["vendor"].id,
            slot=1,
            name="Communications Shop",
            slug="communications-shop",
            city="Kathmandu",
            province="Bagmati",
        )
        second_shop = Shop(
            owner_user_id=users["vendor"].id,
            slot=2,
            name="Communications Second Shop",
            slug="communications-second-shop",
            city="Lalitpur",
            province="Bagmati",
        )
        other_shop = Shop(
            owner_user_id=users["other"].id,
            slot=1,
            name="Communications Other Shop",
            slug="communications-other-shop",
            city="Bhaktapur",
            province="Bagmati",
        )
        session.add_all((shop, second_shop, other_shop))
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
            "shop2": second_shop.id,
            "other_shop": other_shop.id,
            "product": product.id,
            "order": order.id,
            "order_item": item.id,
        }

    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("vmarket_session", tokens["customer"])
        client.headers["X-VMarket-Workspace"] = "customer"
        yield client, factory, ids, app
    await engine.dispose()


def _sign_in(
    client: AsyncClient,
    user: str,
    workspace: str = "customer",
    shop_id: UUID | None = None,
) -> None:
    client.cookies.set("vmarket_session", f"communications-{user}-session-token")
    client.headers["X-VMarket-Workspace"] = workspace
    client.headers.pop("X-VMarket-Shop-Id", None)
    if shop_id is not None:
        client.headers["X-VMarket-Shop-Id"] = str(shop_id)


@pytest.mark.asyncio
async def test_conversations_persist_unread_counts_and_enforce_participants(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids, _ = communications_client
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

    _sign_in(client, "vendor", "vendor", ids["shop"])
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
        assert notification.workspace == "vendor"
        assert notification.shop_id == ids["shop"]

    _sign_in(client, "customer")
    await client.post(
        f"/api/v1/me/conversations/{conversation_id}/messages",
        json={"content": "One more question."},
    )
    _sign_in(client, "vendor", "vendor", UUID(int=0))
    unauthorized = await client.get(f"/api/v1/me/conversations/{conversation_id}/messages")
    assert unauthorized.status_code == 404
    _sign_in(client, "vendor", "vendor")
    missing_shop = await client.get("/api/v1/me/conversations")
    assert missing_shop.status_code == 422
    async with factory() as session:
        message = await session.scalar(
            select(ConversationMessage).where(
                ConversationMessage.conversation_id == UUID(conversation_id),
                ConversationMessage.content == "One more question.",
            )
        )
        assert message is not None
        assert message.read_at is None


@pytest.mark.asyncio
async def test_support_tickets_are_scoped_by_workspace_and_selected_shop(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids, _ = communications_client
    customer_ticket = await client.post(
        "/api/v1/me/support-tickets",
        json={"subject": "Customer help", "body": "Please assist."},
    )
    assert customer_ticket.status_code == 201
    assert customer_ticket.json()["workspace"] == "customer"
    assert customer_ticket.json()["shop_id"] is None

    _sign_in(client, "vendor", "vendor", ids["shop"])
    vendor_ticket = await client.post(
        "/api/v1/me/support-tickets",
        json={"subject": "Vendor help", "body": "Please assist my shop."},
    )
    assert vendor_ticket.status_code == 201
    assert vendor_ticket.json()["workspace"] == "vendor"
    assert vendor_ticket.json()["shop_id"] == str(ids["shop"])
    vendor_tickets = await client.get("/api/v1/me/support-tickets")
    assert [ticket["id"] for ticket in vendor_tickets.json()] == [vendor_ticket.json()["id"]]

    _sign_in(client, "customer")
    customer_tickets = await client.get("/api/v1/me/support-tickets")
    assert [ticket["id"] for ticket in customer_tickets.json()] == [customer_ticket.json()["id"]]
    async with factory() as session:
        notifications = await session.scalars(
            select(OrderNotification).where(OrderNotification.title == "New support ticket")
        )
        notifications = list(notifications)
        assert len(notifications) == 2
        assert all(notification.user_id == ids["admin"] for notification in notifications)
        assert all(notification.workspace == "admin" for notification in notifications)


@pytest.mark.asyncio
async def test_same_account_workspace_and_owned_shop_data_are_isolated(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids, _ = communications_client

    conversation_ids: dict[str, UUID] = {}
    for shop_key in ("shop", "shop2"):
        started = await client.post(
            "/api/v1/me/conversations",
            json={"shop_id": str(ids[shop_key])},
        )
        assert started.status_code == 201
        conversation_ids[shop_key] = UUID(started.json()["id"])
        message = await client.post(
            f"/api/v1/me/conversations/{conversation_ids[shop_key]}/messages",
            json={"content": f"Message for {shop_key}"},
        )
        assert message.status_code == 201

    _sign_in(client, "vendor", "customer")
    customer_conversation = await client.post(
        "/api/v1/me/conversations",
        json={"shop_id": str(ids["other_shop"])},
    )
    assert customer_conversation.status_code == 201
    customer_conversation_id = UUID(customer_conversation.json()["id"])
    sent = await client.post(
        f"/api/v1/me/conversations/{customer_conversation_id}/messages",
        json={"content": "I am contacting another shop as a customer."},
    )
    assert sent.status_code == 201
    _sign_in(client, "other", "vendor", ids["other_shop"])
    response = await client.post(
        f"/api/v1/me/conversations/{customer_conversation_id}/messages",
        json={"content": "Reply to the same account in Customer mode."},
    )
    assert response.status_code == 201

    async with factory() as session:
        session.add_all(
            [
                OrderNotification(
                    user_id=ids["vendor"],
                    workspace="account",
                    shop_id=None,
                    title="Account notice",
                    message="Available in each workspace.",
                ),
                OrderNotification(
                    user_id=ids["vendor"],
                    workspace="customer",
                    shop_id=None,
                    title="Customer notice",
                    message="Visible in Customer mode.",
                ),
            ]
        )
        await session.commit()

    _sign_in(client, "vendor", "vendor", ids["shop"])
    shop1_conversations = await client.get("/api/v1/me/conversations")
    assert [item["id"] for item in shop1_conversations.json()] == [str(conversation_ids["shop"])]
    assert shop1_conversations.json()[0]["unread_count"] == 1
    wrong_mode_conversation = await client.get(
        f"/api/v1/me/conversations/{customer_conversation_id}"
    )
    assert wrong_mode_conversation.status_code == 404
    wrong_mode_messages = await client.get(
        f"/api/v1/me/conversations/{customer_conversation_id}/messages"
    )
    assert wrong_mode_messages.status_code == 404
    cross_shop_read = await client.get(
        f"/api/v1/me/conversations/{conversation_ids['shop2']}/messages"
    )
    assert cross_shop_read.status_code == 404
    cross_shop_write = await client.post(
        f"/api/v1/me/conversations/{conversation_ids['shop2']}/messages",
        json={"content": "Must remain isolated from shop one."},
    )
    assert cross_shop_write.status_code == 404
    shop1_messages = await client.get(
        f"/api/v1/me/conversations/{conversation_ids['shop']}/messages"
    )
    assert shop1_messages.status_code == 200
    assert len(shop1_messages.json()) == 1
    assert (await client.get("/api/v1/me/conversations")).json()[0]["unread_count"] == 0

    shop1_tickets = await client.post(
        "/api/v1/me/support-tickets",
        json={"subject": "Shop one ticket", "body": "Only for shop one."},
    )
    assert shop1_tickets.status_code == 201
    shop1_ticket_id = shop1_tickets.json()["id"]
    shop1_notifications = await client.get("/api/v1/me/notifications")
    shop1_notification_rows = shop1_notifications.json()
    assert {row["workspace"] for row in shop1_notification_rows} == {"account", "vendor"}
    assert "customer" not in {row["workspace"] for row in shop1_notification_rows}
    assert {
        row["conversation_id"]
        for row in shop1_notification_rows
        if row["conversation_id"] is not None
    } == {str(conversation_ids["shop"])}
    shop1_support = await client.get("/api/v1/me/support-tickets")
    assert [item["id"] for item in shop1_support.json()] == [shop1_ticket_id]

    _sign_in(client, "vendor", "vendor", ids["shop2"])
    shop2_conversations = await client.get("/api/v1/me/conversations")
    assert [item["id"] for item in shop2_conversations.json()] == [str(conversation_ids["shop2"])]
    assert shop2_conversations.json()[0]["unread_count"] == 1
    async with factory() as session:
        shop2_message = await session.scalar(
            select(ConversationMessage).where(
                ConversationMessage.conversation_id == conversation_ids["shop2"]
            )
        )
        assert shop2_message is not None
        assert shop2_message.content == "Message for shop2"
        assert shop2_message.read_at is None
    shop2_notifications = await client.get("/api/v1/me/notifications")
    assert {
        row["conversation_id"]
        for row in shop2_notifications.json()
        if row["conversation_id"] is not None
    } == {str(conversation_ids["shop2"])}
    shop2_ticket = await client.post(
        "/api/v1/me/support-tickets",
        json={"subject": "Shop two ticket", "body": "Only for shop two."},
    )
    assert shop2_ticket.status_code == 201
    shop2_support = await client.get("/api/v1/me/support-tickets")
    assert [item["id"] for item in shop2_support.json()] == [shop2_ticket.json()["id"]]

    _sign_in(client, "vendor", "customer")
    customer_conversations = await client.get("/api/v1/me/conversations")
    assert [item["id"] for item in customer_conversations.json()] == [str(customer_conversation_id)]
    assert customer_conversations.json()[0]["unread_count"] == 1
    customer_messages = await client.get(
        f"/api/v1/me/conversations/{customer_conversation_id}/messages"
    )
    assert customer_messages.status_code == 200
    assert len(customer_messages.json()) == 2
    assert (await client.get("/api/v1/me/conversations")).json()[0]["unread_count"] == 0
    customer_support = await client.post(
        "/api/v1/me/support-tickets",
        json={"subject": "Customer ticket", "body": "This is not shop scoped."},
    )
    assert customer_support.status_code == 201
    customer_tickets = await client.get("/api/v1/me/support-tickets")
    assert [item["id"] for item in customer_tickets.json()] == [customer_support.json()["id"]]
    customer_notifications = await client.get("/api/v1/me/notifications")
    assert {row["workspace"] for row in customer_notifications.json()} == {
        "account",
        "customer",
    }
    assert {row["title"] for row in customer_notifications.json()} == {
        "Account notice",
        "Customer notice",
        "New message from Other",
    }


@pytest.mark.asyncio
async def test_live_websocket_does_not_deliver_after_session_revocation(
    communications_client: CommunicationsClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, factory, ids, app = communications_client
    started = await client.post(
        "/api/v1/me/conversations",
        json={"shop_id": str(ids["shop"])},
    )
    assert started.status_code == 201
    conversation_id = UUID(started.json()["id"])
    monkeypatch.setattr(communications_router, "get_session_factory", lambda: factory)

    with TestClient(app) as test_client:
        test_client.cookies.set("vmarket_session", "communications-vendor-session-token")
        path = f"/api/v1/communications/ws/{conversation_id}?workspace=vendor&shop_id={ids['shop']}"
        with test_client.websocket_connect(
            path,
            headers={"origin": get_settings().cors_origins[0]},
        ) as websocket:
            live_message = MessageRead(
                id=uuid4(),
                conversation_id=conversation_id,
                sender_id=ids["customer"],
                content="Delivered while the session is active.",
                read_at=None,
                created_at=datetime.now(timezone.utc),
            )
            test_client.portal.call(connections.publish, conversation_id, live_message)
            assert websocket.receive_json()["content"] == live_message.content

            async def revoke_vendor_session() -> None:
                async with factory() as session:
                    auth_session = await session.scalar(
                        select(AuthSession).where(AuthSession.user_id == ids["vendor"])
                    )
                    assert auth_session is not None
                    auth_session.revoked_at = datetime.now(timezone.utc)
                    await session.commit()

            test_client.portal.call(revoke_vendor_session)
            revoked_message = live_message.model_copy(
                update={"id": uuid4(), "content": "Must not be delivered."}
            )
            test_client.portal.call(connections.publish, conversation_id, revoked_message)
            with pytest.raises(WebSocketDisconnect) as closed:
                websocket.receive_json()
            assert closed.value.code == 4403


@pytest.mark.asyncio
async def test_websocket_rejects_mismatched_workspace_and_shop_handshakes(
    communications_client: CommunicationsClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, factory, ids, app = communications_client
    started = await client.post(
        "/api/v1/me/conversations",
        json={"shop_id": str(ids["shop"])},
    )
    assert started.status_code == 201
    conversation_id = UUID(started.json()["id"])
    monkeypatch.setattr(communications_router, "get_session_factory", lambda: factory)
    origin = get_settings().cors_origins[0]

    invalid_contexts = (
        (
            "communications-vendor-session-token",
            f"?workspace=vendor&shop_id={ids['shop2']}",
        ),
        (
            "communications-customer-session-token",
            f"?workspace=vendor&shop_id={ids['shop']}",
        ),
        ("communications-vendor-session-token", "?workspace=customer"),
    )
    with TestClient(app) as test_client:
        for token, query in invalid_contexts:
            test_client.cookies.set("vmarket_session", token)
            with pytest.raises(WebSocketDisconnect) as closed:
                with test_client.websocket_connect(
                    f"/api/v1/communications/ws/{conversation_id}{query}",
                    headers={"origin": origin},
                ):
                    pytest.fail("A mismatched workspace/shop handshake was accepted.")
            assert closed.value.code == 4403


@pytest.mark.asyncio
async def test_communications_require_workspace_and_legacy_admin_role_is_not_authoritative(
    communications_client: CommunicationsClient,
) -> None:
    client, _, _, _ = communications_client
    client.headers.pop("X-VMarket-Workspace", None)
    missing_context = await client.get("/api/v1/me/conversations")
    assert missing_context.status_code == 422

    _sign_in(client, "other", "admin")
    legacy_admin = await client.get("/api/v1/admin/support-tickets")
    assert legacy_admin.status_code == 403


@pytest.mark.asyncio
async def test_reviews_require_delivered_purchase_and_admin_moderation(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids, _ = communications_client
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

    _sign_in(client, "admin", "admin")
    moderated = await client.patch(
        f"/api/v1/admin/reviews/{review['id']}/moderation",
        json={"status": "visible"},
    )
    assert moderated.status_code == 200
    assert moderated.json()["moderation_status"] == "visible"

    _sign_in(client, "vendor", "vendor", ids["shop"])
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

    _sign_in(client, "admin", "admin")
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
        assert notice.workspace == "customer"
        assert notice.shop_id is None
        report_status = await session.scalar(
            select(ReviewReport).where(ReviewReport.review_id == UUID(review["id"]))
        )
        assert report_status is not None
        assert report_status.status == "resolved"


@pytest.mark.asyncio
async def test_support_disputes_are_order_scoped_and_admin_updates_are_audited(
    communications_client: CommunicationsClient,
) -> None:
    client, factory, ids, _ = communications_client
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

    _sign_in(client, "admin", "admin")
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
    client, factory, ids, _ = communications_client
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
