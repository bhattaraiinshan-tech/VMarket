import asyncio
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, Shop
from app.catalog.seed_demo import _ensure_local_development, seed_demo_data
from app.core.config import get_settings
from app.db.session import get_engine, get_session_factory
from app.trading.models import (
    TradeBusinessReview,
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

DEMO_PREFIX = "phase6-demo"
DEMO_WORKFLOW_STATES = ("placed", "confirmed", "shipped", "received")
DEMO_TRANSFER_STATES = (
    "requested",
    "approved",
    "shipped",
    "received",
    "requested",
    "approved",
    "shipped",
    "received",
    "requested",
    "received",
)


def _demo_id(kind: str, index: int) -> UUID:
    return uuid5(NAMESPACE_URL, f"vendors-market:{DEMO_PREFIX}:{kind}:{index:02}")


async def _demo_products(session: AsyncSession) -> list[Product]:
    products = list(
        await session.scalars(
            select(Product)
            .where(
                Product.slug.like("demo-%"),
                Product.slug.not_like("demo-trade-%"),
                Product.status == "approved",
            )
            .order_by(Product.slug)
        )
    )
    if len(products) != 20:
        raise RuntimeError(
            "The trade demo requires the 20 approved products created by "
            "`python -m app.catalog.seed_demo`."
        )
    shops = {
        shop.id
        for shop in await session.scalars(
            select(Shop).where(Shop.id.in_({product.shop_id for product in products}))
        )
    }
    if len(shops) != 10:
        raise RuntimeError("The trade demo requires products from all 10 demo vendor shops.")
    return products


async def seed_trade_demo_data(session: AsyncSession) -> None:
    products = await _demo_products(session)
    trade_products: list[Product] = []
    for index, product in enumerate(products):
        existing_listing = await session.scalar(
            select(WholesaleListing).where(WholesaleListing.product_id == product.id)
        )
        if existing_listing is not None and existing_listing.id != _demo_id("listing", index):
            replacement_slug = f"demo-trade-{product.slug}"
            replacement = await session.scalar(
                select(Product).where(Product.slug == replacement_slug)
            )
            if replacement is None:
                replacement = Product(
                    id=_demo_id("trade-product", index),
                    shop_id=product.shop_id,
                    category_id=product.category_id,
                    brand_id=product.brand_id,
                    name=f"{product.name} Wholesale Sample",
                    slug=replacement_slug,
                    description="Local-only wholesale trade sample product.",
                    sku=f"DEMO-TRADE-{index + 1:02}",
                    price=product.price,
                    stock=product.stock,
                    attributes={"origin": "Nepal", "demo_trade": "true"},
                    status="approved",
                )
                session.add(replacement)
                await session.flush()
            elif replacement.shop_id != product.shop_id:
                raise RuntimeError(
                    f"Demo trade product slug {replacement_slug} is owned by another shop."
                )
            trade_products.append(replacement)
        else:
            trade_products.append(product)
    products = trade_products

    shops_by_id = {
        shop.id: shop
        for shop in await session.scalars(
            select(Shop).where(Shop.id.in_({product.shop_id for product in products}))
        )
    }
    shop_indexes = {shop_id: index for index, shop_id in enumerate(sorted(shops_by_id, key=str))}
    listings: dict[UUID, WholesaleListing] = {}

    for index, product in enumerate(products):
        listing = await session.scalar(
            select(WholesaleListing).where(WholesaleListing.product_id == product.id)
        )
        if listing is not None:
            if listing.shop_id != product.shop_id:
                raise RuntimeError(
                    f"Demo product {product.slug} has a listing owned by another shop."
                )
            if listing.id != _demo_id("listing", index):
                raise RuntimeError(
                    f"Demo product {product.slug} already has a non-demo wholesale listing."
                )
            if not listing.is_active:
                raise RuntimeError(f"Demo wholesale listing for {product.slug} is inactive.")
            listings[product.id] = listing
            continue
        minimum_quantity = 2
        listing = WholesaleListing(
            id=_demo_id("listing", index),
            shop_id=product.shop_id,
            product_id=product.id,
            minimum_order_quantity=minimum_quantity,
            available_quantity=product.stock,
            unit_label="piece",
            is_active=True,
        )
        session.add(listing)
        listings[product.id] = listing
        base_price = (product.price * Decimal("0.80")).quantize(Decimal("0.01"))
        session.add_all(
            [
                WholesalePriceTier(
                    id=_demo_id("price-tier-1", index),
                    listing_id=listing.id,
                    minimum_quantity=minimum_quantity,
                    unit_price=base_price,
                ),
                WholesalePriceTier(
                    id=_demo_id("price-tier-2", index),
                    listing_id=listing.id,
                    minimum_quantity=minimum_quantity * 5,
                    unit_price=(base_price * Decimal("0.90")).quantize(Decimal("0.01")),
                ),
            ]
        )

    await session.flush()
    existing_rfq_ids = set(
        await session.scalars(
            select(TradeRFQ.id).where(
                TradeRFQ.id.in_({_demo_id("rfq", index) for index in range(20)})
            )
        )
    )
    reserve_for_orders: dict[UUID, int] = {}

    for index, product in enumerate(products):
        rfq_id = _demo_id("rfq", index)
        if rfq_id in existing_rfq_ids:
            continue
        listing = listings[product.id]
        seller_index = shop_indexes[product.shop_id]
        buyer_index = (seller_index + 1 + index // 2) % len(shops_by_id)
        buyer_shop = sorted(shops_by_id.values(), key=lambda shop: str(shop.id))[buyer_index]
        quantity = 3 + index % 3
        status = DEMO_WORKFLOW_STATES[index % len(DEMO_WORKFLOW_STATES)]
        if product.stock < quantity or listing.available_quantity < quantity:
            raise RuntimeError(
                f"Demo product {product.slug} has insufficient stock for sample trade."
            )
        price_tier = (
            await session.scalars(
                select(WholesalePriceTier)
                .where(WholesalePriceTier.listing_id == listing.id)
                .order_by(WholesalePriceTier.minimum_quantity)
            )
        ).first()
        if price_tier is None:
            raise RuntimeError(f"Demo listing for {product.slug} has no wholesale price tiers.")

        quote_id = _demo_id("quote", index)
        order_id = _demo_id("purchase-order", index)
        session.add(
            TradeRFQ(
                id=rfq_id,
                buyer_shop_id=buyer_shop.id,
                seller_shop_id=product.shop_id,
                listing_id=listing.id,
                quantity=quantity,
                delivery_terms="Deliver to receiving shop; confirm quantity on arrival.",
                message=f"Demo wholesale request {index + 1:02}: please quote {quantity} units.",
                status="accepted",
            )
        )
        await session.flush()
        session.add(
            TradeQuote(
                id=quote_id,
                rfq_id=rfq_id,
                revision=1,
                quantity=quantity,
                unit_price=price_tier.unit_price,
                delivery_terms="FOB supplier shop; delivery arranged by buyer.",
                status="accepted",
            )
        )
        await session.flush()
        session.add_all(
            [
                TradeNegotiationEvent(
                    id=_demo_id("buyer-negotiation", index),
                    rfq_id=rfq_id,
                    actor_shop_id=buyer_shop.id,
                    note=f"Please quote {quantity} units for my shop.",
                ),
                TradeNegotiationEvent(
                    id=_demo_id("seller-negotiation", index),
                    rfq_id=rfq_id,
                    quote_id=quote_id,
                    actor_shop_id=product.shop_id,
                    note=f"Wholesale offer: NPR {price_tier.unit_price} per unit.",
                ),
            ]
        )
        session.add(
            TradePurchaseOrder(
                id=order_id,
                rfq_id=rfq_id,
                quote_id=quote_id,
                buyer_shop_id=buyer_shop.id,
                seller_shop_id=product.shop_id,
                listing_id=listing.id,
                order_number=f"DEMO-VPO-{index + 1:04}",
                quantity=quantity,
                unit_price=price_tier.unit_price,
                total=price_tier.unit_price * quantity,
                delivery_terms="FOB supplier shop; delivery arranged by buyer.",
                status=status,
                inventory_reserved=status in {"confirmed", "shipped", "received"},
            )
        )
        await session.flush()
        history: list[tuple[str, str | None]] = [("placed", None)]
        if status in {"confirmed", "shipped", "received"}:
            history.append(("confirmed", "placed"))
        if status in {"shipped", "received"}:
            history.append(("shipped", "confirmed"))
        if status == "received":
            history.append(("received", "shipped"))
        for event_index, (next_status, previous_status) in enumerate(history):
            actor_shop_id = (
                buyer_shop.id
                if next_status == "received"
                else product.shop_id
                if next_status != "placed"
                else buyer_shop.id
            )
            session.add(
                TradeOrderEvent(
                    id=_demo_id(f"order-event-{event_index}", index),
                    order_id=order_id,
                    actor_shop_id=actor_shop_id,
                    from_status=previous_status,
                    to_status=next_status,
                    note=f"Demo purchase order {next_status}.",
                )
            )
        if status in {"confirmed", "shipped", "received"}:
            reserve_for_orders[product.id] = quantity
        if status == "received":
            session.add(
                TradeBusinessReview(
                    id=_demo_id("business-review", index),
                    order_id=order_id,
                    reviewer_shop_id=buyer_shop.id,
                    supplier_shop_id=product.shop_id,
                    rating=4 + index % 2,
                    body="Reliable wholesale supplier with clear communication and good quality.",
                )
            )

    for product_id, quantity in reserve_for_orders.items():
        product = next(item for item in products if item.id == product_id)
        product.stock -= quantity
        listing = listings[product_id]
        listing.available_quantity -= quantity

    await session.flush()
    existing_transfer_ids = set(
        await session.scalars(
            select(TradeStockTransfer.id).where(
                TradeStockTransfer.id.in_(
                    {_demo_id("transfer", index) for index in range(len(DEMO_TRANSFER_STATES))}
                )
            )
        )
    )
    products_by_category: dict[UUID, list[Product]] = {}
    for product in products:
        products_by_category.setdefault(product.category_id, []).append(product)
    transfer_index = 0
    used_transfer_pairs: set[tuple[UUID, UUID]] = set()
    for category_products in products_by_category.values():
        pairs = [
            (source, destination)
            for source in category_products
            for destination in category_products
            if source.shop_id != destination.shop_id
        ]
        while transfer_index < len(DEMO_TRANSFER_STATES):
            transfer_id = _demo_id("transfer", transfer_index)
            if transfer_id in existing_transfer_ids:
                transfer_index += 1
                continue
            status = DEMO_TRANSFER_STATES[transfer_index]
            quantity = 1
            pair = next(
                (
                    (source, destination)
                    for source, destination in pairs
                    if (source.id, destination.id) not in used_transfer_pairs
                    if status not in {"shipped", "received"}
                    or (
                        source.stock > quantity
                        and listings[source.id].available_quantity - quantity
                        >= listings[source.id].minimum_order_quantity
                    )
                ),
                None,
            )
            if pair is None:
                break
            source_product, destination_product = pair
            used_transfer_pairs.add((source_product.id, destination_product.id))
            source_shop = shops_by_id[source_product.shop_id]
            destination_shop = shops_by_id[destination_product.shop_id]
            if status in {"shipped", "received"}:
                source_product.stock -= quantity
                listings[source_product.id].available_quantity -= quantity
            session.add(
                TradeStockTransfer(
                    id=transfer_id,
                    source_shop_id=source_shop.id,
                    destination_shop_id=destination_shop.id,
                    source_product_id=source_product.id,
                    destination_product_id=destination_product.id,
                    quantity=quantity,
                    delivery_terms="Demo transfer; receiving shop confirms the goods on arrival.",
                    status=status,
                )
            )
            await session.flush()
            event_history: list[tuple[str, str | None]] = [("requested", None)]
            if status in {"approved", "shipped", "received"}:
                event_history.append(("approved", "requested"))
            if status in {"shipped", "received"}:
                event_history.append(("shipped", "approved"))
            if status == "received":
                event_history.append(("received", "shipped"))
                destination_product.stock += quantity
                listings[destination_product.id].available_quantity += quantity
            for event_index, (next_status, previous_status) in enumerate(event_history):
                actor_shop_id = (
                    destination_shop.id
                    if next_status in {"approved", "received"}
                    else source_shop.id
                )
                session.add(
                    TradeTransferEvent(
                        id=_demo_id(f"transfer-event-{event_index}", transfer_index),
                        transfer_id=transfer_id,
                        actor_shop_id=actor_shop_id,
                        from_status=previous_status,
                        to_status=next_status,
                        note=f"Demo transfer {next_status}.",
                    )
                )
            transfer_index += 1
    if transfer_index < len(DEMO_TRANSFER_STATES):
        raise RuntimeError("Not enough matching demo products to create 10 stock transfers.")


async def _seed() -> None:
    settings = get_settings()
    _ensure_local_development(settings)
    try:
        async with get_session_factory()() as session, session.begin():
            await seed_demo_data(session)
            await session.flush()
            await seed_trade_demo_data(session)
        print(
            "Seeded 20 demo wholesale listings, 20 RFQs, 20 quotes, "
            "20 purchase orders, 10 stock transfers, and 5 supplier reviews."
        )
    finally:
        await get_engine().dispose()


def main() -> None:
    asyncio.run(_seed())


if __name__ == "__main__":
    main()
