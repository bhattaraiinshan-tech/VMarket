from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import TypeAlias
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.catalog.models import CatalogCategory, Product, Shop
from app.catalog.seed_demo import seed_demo_data
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_session
from app.identity.models import AuthSession, User, UserRole, VendorProfile
from app.identity.security import hash_token
from app.main import create_app
from app.trading.models import (
    TradeBusinessReview,
    TradeDocument,
    TradeNegotiationEvent,
    TradeOrderEvent,
    TradePurchaseOrder,
    TradeQuote,
    TradeRFQ,
    TradeStockTransfer,
    TradeTransferEvent,
    WholesaleListing,
    WholesalePriceTier,
)
from app.trading.seed_demo import seed_trade_demo_data

TradingClient: TypeAlias = tuple[AsyncClient, async_sessionmaker[AsyncSession], dict[str, UUID]]


@pytest_asyncio.fixture
async def trading_client() -> AsyncIterator[TradingClient]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    names = ("buyer", "seller", "other")
    tokens = {name: f"trading-{name}-session-token" for name in names}

    async def override_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    async with factory() as session:
        users: dict[str, User] = {}
        for name in names:
            user = User(
                email=f"{name}@trading.example",
                password_hash="unused",
                email_verified=True,
                account_status="active",
            )
            session.add(user)
            users[name] = user
        await session.flush()
        for name, user in users.items():
            session.add(UserRole(user_id=user.id, role="vendor"))
            session.add(VendorProfile(user_id=user.id, business_name=name))
            session.add(
                AuthSession(
                    user_id=user.id,
                    token_hash=hash_token(tokens[name]),
                    expires_at=datetime.now(timezone.utc) + timedelta(days=30),
                )
            )
        category = CatalogCategory(name="Grains", slug="trading-grains")
        session.add(category)
        await session.flush()
        shops: dict[str, Shop] = {}
        for name, user in users.items():
            shop = Shop(
                slot=1,
                owner_user_id=user.id,
                name=f"{name.title()} Market",
                slug=f"{name}-market-trading",
                city="Kathmandu",
                province="Bagmati",
            )
            session.add(shop)
            shops[name] = shop
        await session.flush()
        products: dict[str, Product] = {}
        for name, shop in shops.items():
            product = Product(
                shop_id=shop.id,
                category_id=category.id,
                name=f"{name.title()} Rice",
                slug=f"{name}-rice-trading",
                description="Wholesale rice for endpoint tests.",
                sku=f"{name.upper()}-RICE",
                price=Decimal("100.00"),
                stock=100,
                attributes={},
                status="approved",
            )
            session.add(product)
            products[name] = product
        await session.flush()
        listing = WholesaleListing(
            shop_id=shops["seller"].id,
            product_id=products["seller"].id,
            minimum_order_quantity=10,
            available_quantity=80,
            unit_label="sack",
            is_active=True,
        )
        session.add(listing)
        await session.commit()
        ids = {
            "buyer": users["buyer"].id,
            "seller": users["seller"].id,
            "other": users["other"].id,
            "buyer_shop": shops["buyer"].id,
            "seller_shop": shops["seller"].id,
            "other_shop": shops["other"].id,
            "buyer_product": products["buyer"].id,
            "seller_product": products["seller"].id,
            "other_product": products["other"].id,
            "listing": listing.id,
        }

    app = create_app()
    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("vmarket_session", tokens["buyer"])
        client.headers["X-VMarket-Workspace"] = "vendor"
        client.headers["X-VMarket-Shop-Id"] = str(shops["buyer"].id)
        for name, shop in shops.items():
            client.headers[f"X-Test-Shop-{name}"] = str(shop.id)
        yield client, factory, ids
    await engine.dispose()


def _sign_in(client: AsyncClient, user: str) -> None:
    client.cookies.set("vmarket_session", f"trading-{user}-session-token")
    client.headers["X-VMarket-Workspace"] = "vendor"
    client.headers["X-VMarket-Shop-Id"] = client.headers[f"X-Test-Shop-{user}"]


async def _create_rfq(client: AsyncClient, listing_id: UUID) -> str:
    response = await client.post(
        "/api/v1/trade/rfqs",
        json={
            "listing_id": str(listing_id),
            "quantity": 20,
            "delivery_terms": "Deliver to buyer shop, Kathmandu.",
            "message": "Please quote for 20 sacks.",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.asyncio
async def test_wholesale_rfq_purchase_receipt_history_and_review(
    trading_client: TradingClient,
) -> None:
    client, factory, ids = trading_client
    listings = await client.get("/api/v1/trade/listings?q=rice")
    assert listings.status_code == 200
    assert listings.json()[0]["minimum_order_quantity"] == 10
    assert listings.json()[0]["price_tiers"] == []

    rfq_id = await _create_rfq(client, ids["listing"])
    _sign_in(client, "other")
    assert (await client.get("/api/v1/trade/rfqs")).json() == []
    unauthorized_quote = await client.post(
        f"/api/v1/trade/rfqs/{rfq_id}/quotes",
        json={
            "quantity": 20,
            "unit_price": "75.00",
            "delivery_terms": "FOB.",
            "note": "Unauthorized offer.",
        },
    )
    assert unauthorized_quote.status_code == 404

    _sign_in(client, "seller")
    quote_response = await client.post(
        f"/api/v1/trade/rfqs/{rfq_id}/quotes",
        json={
            "quantity": 20,
            "unit_price": "75.50",
            "delivery_terms": "FOB Kathmandu warehouse.",
            "valid_until": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "note": "Price includes bulk discount.",
        },
    )
    assert quote_response.status_code == 201, quote_response.text
    assert quote_response.json()["quotes"][0]["revision"] == 1
    assert len(quote_response.json()["negotiation_history"]) == 2
    quote_id = quote_response.json()["quotes"][0]["id"]

    _sign_in(client, "buyer")
    order_response = await client.post(f"/api/v1/trade/quotes/{quote_id}/accept")
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()
    assert order["total"] == "1510.00"
    order_id = order["id"]

    _sign_in(client, "seller")
    rejected = await client.post(
        f"/api/v1/trade/orders/{order_id}/status", json={"status": "received"}
    )
    assert rejected.status_code == 409
    confirmed = await client.post(
        f"/api/v1/trade/orders/{order_id}/status", json={"status": "confirmed"}
    )
    assert confirmed.status_code == 200, confirmed.text
    shipped = await client.post(
        f"/api/v1/trade/orders/{order_id}/status", json={"status": "shipped"}
    )
    assert shipped.status_code == 200

    _sign_in(client, "buyer")
    received = await client.post(
        f"/api/v1/trade/orders/{order_id}/status",
        json={"status": "received", "note": "All sacks arrived."},
    )
    assert received.status_code == 200
    assert len(received.json()["events"]) == 4
    review = await client.post(
        f"/api/v1/trade/orders/{order_id}/reviews",
        json={"rating": 5, "body": "Good quality and timely delivery."},
    )
    assert review.status_code == 201
    assert (
        len((await client.get(f"/api/v1/trade/suppliers/{ids['seller_shop']}/reviews")).json()) == 1
    )
    supplier = await client.get("/api/v1/trade/suppliers?q=rice")
    assert supplier.status_code == 200
    assert supplier.json()[0]["completed_trade_count"] == 1

    async with factory() as session:
        product = await session.get(Product, ids["seller_product"])
        listing = await session.get(WholesaleListing, ids["listing"])
        stored_order = await session.get(TradePurchaseOrder, UUID(order_id))
        stored_review = await session.scalar(select(TradeBusinessReview))
        assert product is not None and product.stock == 80
        assert listing is not None and listing.available_quantity == 60
        assert stored_order is not None and stored_order.status == "received"
        assert stored_review is not None and stored_review.reviewer_shop_id == ids["buyer_shop"]


@pytest.mark.asyncio
async def test_listing_shop_isolation_minimums_and_negotiation_revisions(
    trading_client: TradingClient,
) -> None:
    client, factory, ids = trading_client
    _sign_in(client, "seller")
    invalid_listing = await client.post(
        "/api/v1/vendor/trade/listings",
        json={
            "product_id": str(ids["buyer_product"]),
            "minimum_order_quantity": 10,
            "available_quantity": 30,
            "price_tiers": [{"minimum_quantity": 10, "unit_price": "70.00"}],
        },
    )
    assert invalid_listing.status_code == 404

    _sign_in(client, "buyer")
    below_minimum = await client.post(
        "/api/v1/trade/rfqs",
        json={
            "listing_id": str(ids["listing"]),
            "quantity": 5,
            "delivery_terms": "Delivery.",
            "message": "Quote.",
        },
    )
    assert below_minimum.status_code == 422
    rfq_id = await _create_rfq(client, ids["listing"])
    _sign_in(client, "seller")
    for revision in range(2):
        response = await client.post(
            f"/api/v1/trade/rfqs/{rfq_id}/quotes",
            json={
                "quantity": 20,
                "unit_price": f"{75 - revision}.00",
                "delivery_terms": "FOB.",
                "note": f"Offer revision {revision + 1}.",
            },
        )
        assert response.status_code == 201, response.text
    quotes = response.json()["quotes"]
    assert [quote["revision"] for quote in quotes] == [1, 2]
    assert [quote["status"] for quote in quotes] == ["superseded", "pending"]

    _sign_in(client, "buyer")
    rejected = await client.post(f"/api/v1/trade/quotes/{quotes[-1]['id']}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "open"
    assert rejected.json()["quotes"][-1]["status"] == "rejected"

    _sign_in(client, "other")
    assert len((await client.get("/api/v1/trade/rfqs")).json()) == 0
    async with factory() as session:
        assert await session.scalar(select(TradeStockTransfer)) is None


@pytest.mark.asyncio
async def test_wholesale_search_and_rfq_respect_live_retail_stock(
    trading_client: TradingClient,
) -> None:
    client, factory, ids = trading_client
    async with factory() as session:
        product = await session.get(Product, ids["seller_product"])
        assert product is not None
        product.stock = 8
        await session.commit()

    listings = await client.get("/api/v1/trade/listings")
    assert listings.status_code == 200
    assert listings.json() == []
    rfq = await client.post(
        "/api/v1/trade/rfqs",
        json={
            "listing_id": str(ids["listing"]),
            "quantity": 10,
            "delivery_terms": "Deliver to Kathmandu.",
            "message": "Please quote 10 sacks.",
        },
    )
    assert rfq.status_code == 409
    assert rfq.json()["error"]["code"] == "quantity_unavailable"


@pytest.mark.asyncio
async def test_trade_documents_are_private_to_participating_shops(
    trading_client: TradingClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, factory, ids = trading_client
    async with factory() as session:
        transfer = TradeStockTransfer(
            source_shop_id=ids["buyer_shop"],
            destination_shop_id=ids["seller_shop"],
            source_product_id=ids["buyer_product"],
            destination_product_id=ids["seller_product"],
            quantity=5,
            delivery_terms="Warehouse pickup.",
            status="requested",
        )
        session.add(transfer)
        await session.flush()
        document = TradeDocument(
            transfer_id=transfer.id,
            uploader_shop_id=ids["buyer_shop"],
            original_filename="invoice.pdf",
            object_name=f"trade-documents/{transfer.id}/invoice.pdf",
            content_type="application/pdf",
            file_size=128,
        )
        session.add(document)
        await session.commit()
        document_id = document.id

    class PrivateStorage:
        def presigned_get_object(self, bucket: str, object_name: str, expires: timedelta) -> str:
            settings = get_settings()
            assert bucket == settings.minio_private_bucket
            assert bucket != settings.minio_public_bucket
            assert object_name.startswith("trade-documents/")
            assert expires == timedelta(minutes=5)
            return "https://storage.example/private-document"

    monkeypatch.setattr("app.trading.router.get_minio_client", lambda: PrivateStorage())
    _sign_in(client, "other")
    unauthorized = await client.get(f"/api/v1/trade/documents/{document_id}/url")
    assert unauthorized.status_code == 404

    _sign_in(client, "buyer")
    allowed = await client.get(f"/api/v1/trade/documents/{document_id}/url")
    assert allowed.status_code == 200
    assert allowed.json() == {
        "url": "https://storage.example/private-document",
        "expires_in_seconds": 300,
    }


@pytest.mark.asyncio
async def test_vendor_stock_transfer_requires_receiver_confirmation(
    trading_client: TradingClient,
) -> None:
    client, factory, ids = trading_client
    response = await client.post(
        "/api/v1/trade/transfers",
        json={
            "destination_shop_id": str(ids["seller_shop"]),
            "source_product_id": str(ids["buyer_product"]),
            "destination_product_id": str(ids["seller_product"]),
            "quantity": 12,
            "delivery_terms": "Collect at the wholesale depot.",
        },
    )
    assert response.status_code == 201, response.text
    transfer_id = response.json()["id"]

    _sign_in(client, "buyer")
    unauthorized = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status", json={"status": "received"}
    )
    assert unauthorized.status_code == 409
    unauthorized_approval = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status", json={"status": "approved"}
    )
    assert unauthorized_approval.status_code == 409

    _sign_in(client, "seller")
    approved = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status", json={"status": "approved"}
    )
    assert approved.status_code == 200
    _sign_in(client, "buyer")
    dispatched = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status",
        json={"status": "shipped", "note": "Dispatched."},
    )
    assert dispatched.status_code == 200
    async with factory() as session:
        source = await session.get(Product, ids["buyer_product"])
        destination = await session.get(Product, ids["seller_product"])
        assert source is not None and source.stock == 88
        assert destination is not None and destination.stock == 100

    _sign_in(client, "seller")
    received = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status",
        json={"status": "received", "note": "Count verified."},
    )
    assert received.status_code == 200
    assert received.json()["status"] == "received"
    async with factory() as session:
        destination = await session.get(Product, ids["seller_product"])
        listing = await session.scalar(
            select(WholesaleListing).where(WholesaleListing.product_id == ids["seller_product"])
        )
        transfer = await session.get(TradeStockTransfer, UUID(transfer_id))
        assert destination is not None and destination.stock == 112
        assert listing is not None and listing.available_quantity == 92
        assert transfer is not None and transfer.status == "received"


@pytest.mark.asyncio
async def test_same_owner_trade_is_blocked_but_shop_transfers_remain_scoped(
    trading_client: TradingClient,
) -> None:
    client, factory, ids = trading_client
    async with factory() as session:
        destination = await session.get(Shop, ids["seller_shop"])
        assert destination is not None
        destination.owner_user_id = ids["buyer"]
        destination.slot = 2
        await session.commit()
    rfq = await client.post(
        "/api/v1/trade/rfqs",
        json={
            "listing_id": str(ids["listing"]),
            "quantity": 20,
            "delivery_terms": "Collect.",
            "message": "Please quote.",
        },
    )
    assert rfq.status_code == 422
    assert rfq.json()["error"]["code"] == "self_trade_not_allowed"
    response = await client.post(
        "/api/v1/trade/transfers",
        json={
            "destination_shop_id": str(ids["seller_shop"]),
            "source_product_id": str(ids["buyer_product"]),
            "destination_product_id": str(ids["seller_product"]),
            "quantity": 7,
            "delivery_terms": "Move between owned branches.",
        },
    )
    assert response.status_code == 201, response.text
    transfer_id = response.json()["id"]
    wrong_shop = await client.post(
        f"/api/v1/trade/transfers/{transfer_id}/status", json={"status": "approved"}
    )
    assert wrong_shop.status_code == 409
    for selected_shop, status in (
        ("seller_shop", "approved"),
        ("buyer_shop", "shipped"),
        ("seller_shop", "received"),
    ):
        client.headers["X-VMarket-Shop-Id"] = str(ids[selected_shop])
        changed = await client.post(
            f"/api/v1/trade/transfers/{transfer_id}/status", json={"status": status}
        )
        assert changed.status_code == 200, changed.text
    async with factory() as session:
        source = await session.get(Product, ids["buyer_product"])
        destination_product = await session.get(Product, ids["seller_product"])
        assert source is not None and destination_product is not None
        assert source.stock == 93
        assert destination_product.stock == 107
        assert source.stock + destination_product.stock == 200


@pytest.mark.asyncio
async def test_deactivated_listing_can_be_relisted_but_active_duplicate_conflicts(
    trading_client: TradingClient,
) -> None:
    client, _, ids = trading_client
    _sign_in(client, "seller")
    payload = {
        "product_id": str(ids["seller_product"]),
        "minimum_order_quantity": 10,
        "available_quantity": 50,
        "price_tiers": [{"minimum_quantity": 10, "unit_price": "70.00"}],
    }
    assert (await client.post("/api/v1/vendor/trade/listings", json=payload)).status_code == 409
    delete = await client.delete(f"/api/v1/vendor/trade/listings/{ids['listing']}")
    assert delete.status_code == 204
    relisted = await client.post("/api/v1/vendor/trade/listings", json=payload)
    assert relisted.status_code == 201, relisted.text
    assert relisted.json()["id"] == str(ids["listing"])
    assert relisted.json()["is_active"] is True
    assert relisted.json()["available_quantity"] == 50
    assert len(relisted.json()["price_tiers"]) == 1


@pytest.mark.asyncio
async def test_trade_demo_seed_creates_twenty_workflows_and_is_idempotent() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with factory() as session, session.begin():
            await seed_demo_data(session)
            conflicting_product = await session.scalar(
                select(Product).where(Product.slug == "demo-roasted-coffee-beans-04")
            )
            assert conflicting_product is not None
            existing_listing_id = uuid4()
            session.add(
                WholesaleListing(
                    id=existing_listing_id,
                    shop_id=conflicting_product.shop_id,
                    product_id=conflicting_product.id,
                    minimum_order_quantity=10,
                    available_quantity=17,
                    is_active=False,
                )
            )
            await seed_trade_demo_data(session)

        model_counts = (
            (WholesaleListing, 21),
            (WholesalePriceTier, 40),
            (TradeRFQ, 20),
            (TradeQuote, 20),
            (TradeNegotiationEvent, 40),
            (TradePurchaseOrder, 20),
            (TradeOrderEvent, 50),
            (TradeStockTransfer, 10),
            (TradeTransferEvent, 25),
            (TradeBusinessReview, 5),
        )
        async with factory() as session:
            first_counts = [
                await session.scalar(select(func.count()).select_from(model))
                for model, _ in model_counts
            ]
            preserved_listing = await session.get(WholesaleListing, existing_listing_id)
            assert preserved_listing is not None
            assert preserved_listing.available_quantity == 17
            assert not preserved_listing.is_active
            first_stock = {
                product_id: stock
                for product_id, stock in (
                    await session.execute(select(Product.id, Product.stock))
                ).all()
            }

        async with factory() as session, session.begin():
            await seed_demo_data(session)
            await seed_trade_demo_data(session)

        async with factory() as session:
            second_counts = [
                await session.scalar(select(func.count()).select_from(model))
                for model, _ in model_counts
            ]
            second_stock = {
                product_id: stock
                for product_id, stock in (
                    await session.execute(select(Product.id, Product.stock))
                ).all()
            }

        assert first_counts == [expected for _, expected in model_counts]
        assert second_counts == first_counts
        assert second_stock == first_stock
    finally:
        await engine.dispose()
