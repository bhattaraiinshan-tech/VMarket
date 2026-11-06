import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO
from pathlib import PurePath
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from minio.error import S3Error
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, Shop
from app.core.config import get_settings
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import get_active_shop
from app.storage.client import get_minio_client
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
from app.trading.schemas import (
    TradeBusinessReviewCreate,
    TradeBusinessReviewRead,
    TradeDocumentRead,
    TradeNegotiationEventRead,
    TradeNegotiationNote,
    TradeOrderEventRead,
    TradePurchaseOrderRead,
    TradeQuoteCreate,
    TradeQuoteRead,
    TradeRFQCreate,
    TradeRFQRead,
    TradeStatusUpdate,
    TradeStockTransferCreate,
    TradeStockTransferRead,
    TradeSupplierRead,
    TradeTransferEventRead,
    WholesaleListingCreate,
    WholesaleListingRead,
    WholesalePriceTierRead,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["wholesale and vendor trade"])
MAX_TRADE_DOCUMENT_SIZE = 10 * 1024 * 1024
TRADE_DOCUMENT_TYPES = {
    "application/pdf": (".pdf", b"%PDF-"),
    "image/png": (".png", b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": (".jpg", b"\xff\xd8\xff"),
}


async def _different_owners(session: AsyncSession, buyer: Shop, seller_id: UUID) -> None:
    seller = await session.get(Shop, seller_id)
    if seller is None:
        raise APIError(404, "shop_not_found", "The supplier shop was not found.")
    if seller.owner_user_id == buyer.owner_user_id:
        raise APIError(
            422,
            "self_trade_not_allowed",
            "Purchases and reviews between your own shops are not allowed.",
        )


async def _listing_read(session: AsyncSession, listing: WholesaleListing) -> WholesaleListingRead:
    shop = await session.get(Shop, listing.shop_id)
    product = await session.get(Product, listing.product_id)
    if shop is None or product is None:
        raise APIError(409, "listing_unavailable", "This wholesale listing is no longer available.")
    tiers = list(
        await session.scalars(
            select(WholesalePriceTier)
            .where(WholesalePriceTier.listing_id == listing.id)
            .order_by(WholesalePriceTier.minimum_quantity)
        )
    )
    return WholesaleListingRead(
        id=listing.id,
        shop_id=shop.id,
        shop_name=shop.name,
        shop_slug=shop.slug,
        city=shop.city,
        province=shop.province,
        product_id=product.id,
        product_name=product.name,
        product_description=product.description,
        product_sku=product.sku,
        minimum_order_quantity=listing.minimum_order_quantity,
        available_quantity=min(listing.available_quantity, product.stock),
        unit_label=listing.unit_label,
        is_active=listing.is_active,
        price_tiers=[WholesalePriceTierRead.model_validate(tier) for tier in tiers],
        created_at=listing.created_at,
    )


async def _rfq_read(session: AsyncSession, rfq: TradeRFQ) -> TradeRFQRead:
    buyer = await session.get(Shop, rfq.buyer_shop_id)
    seller = await session.get(Shop, rfq.seller_shop_id)
    listing = await session.get(WholesaleListing, rfq.listing_id)
    product = await session.get(Product, listing.product_id) if listing else None
    if buyer is None or seller is None or product is None:
        raise APIError(409, "rfq_unavailable", "A shop or product in this request is unavailable.")
    quotes = list(
        await session.scalars(
            select(TradeQuote).where(TradeQuote.rfq_id == rfq.id).order_by(TradeQuote.revision)
        )
    )
    history = list(
        await session.scalars(
            select(TradeNegotiationEvent)
            .where(TradeNegotiationEvent.rfq_id == rfq.id)
            .order_by(TradeNegotiationEvent.created_at, TradeNegotiationEvent.id)
        )
    )
    return TradeRFQRead(
        id=rfq.id,
        buyer_shop_id=buyer.id,
        buyer_shop_name=buyer.name,
        seller_shop_id=seller.id,
        seller_shop_name=seller.name,
        listing_id=rfq.listing_id,
        product_name=product.name,
        quantity=rfq.quantity,
        requested_delivery_date=rfq.requested_delivery_date,
        delivery_terms=rfq.delivery_terms,
        message=rfq.message,
        status=rfq.status,
        quotes=[TradeQuoteRead.model_validate(quote) for quote in quotes],
        negotiation_history=[TradeNegotiationEventRead.model_validate(event) for event in history],
        created_at=rfq.created_at,
        updated_at=rfq.updated_at,
    )


async def _purchase_order_read(
    session: AsyncSession, order: TradePurchaseOrder
) -> TradePurchaseOrderRead:
    buyer = await session.get(Shop, order.buyer_shop_id)
    seller = await session.get(Shop, order.seller_shop_id)
    listing = await session.get(WholesaleListing, order.listing_id)
    product = await session.get(Product, listing.product_id) if listing else None
    if buyer is None or seller is None or product is None:
        raise APIError(
            409, "trade_order_unavailable", "A shop or product in this order is unavailable."
        )
    events = list(
        await session.scalars(
            select(TradeOrderEvent)
            .where(TradeOrderEvent.order_id == order.id)
            .order_by(TradeOrderEvent.created_at, TradeOrderEvent.id)
        )
    )
    documents = list(
        await session.scalars(
            select(TradeDocument)
            .where(TradeDocument.purchase_order_id == order.id)
            .order_by(TradeDocument.uploaded_at)
        )
    )
    reviewed = (
        await session.scalar(
            select(TradeBusinessReview.id).where(TradeBusinessReview.order_id == order.id)
        )
    ) is not None
    return TradePurchaseOrderRead(
        id=order.id,
        rfq_id=order.rfq_id,
        quote_id=order.quote_id,
        buyer_shop_id=buyer.id,
        buyer_shop_name=buyer.name,
        seller_shop_id=seller.id,
        seller_shop_name=seller.name,
        listing_id=order.listing_id,
        product_name=product.name,
        order_number=order.order_number,
        quantity=order.quantity,
        unit_price=order.unit_price,
        total=order.total,
        delivery_terms=order.delivery_terms,
        status=order.status,
        business_review_submitted=reviewed,
        events=[TradeOrderEventRead.model_validate(event) for event in events],
        documents=[TradeDocumentRead.model_validate(document) for document in documents],
        created_at=order.created_at,
        updated_at=order.updated_at,
    )


async def _transfer_read(
    session: AsyncSession, transfer: TradeStockTransfer
) -> TradeStockTransferRead:
    source = await session.get(Shop, transfer.source_shop_id)
    destination = await session.get(Shop, transfer.destination_shop_id)
    source_product = await session.get(Product, transfer.source_product_id)
    destination_product = await session.get(Product, transfer.destination_product_id)
    if (
        source is None
        or destination is None
        or source_product is None
        or destination_product is None
    ):
        raise APIError(
            409, "trade_transfer_unavailable", "A shop or product in this transfer is unavailable."
        )
    events = list(
        await session.scalars(
            select(TradeTransferEvent)
            .where(TradeTransferEvent.transfer_id == transfer.id)
            .order_by(TradeTransferEvent.created_at, TradeTransferEvent.id)
        )
    )
    documents = list(
        await session.scalars(
            select(TradeDocument)
            .where(TradeDocument.transfer_id == transfer.id)
            .order_by(TradeDocument.uploaded_at)
        )
    )
    return TradeStockTransferRead(
        id=transfer.id,
        source_shop_id=source.id,
        source_shop_name=source.name,
        destination_shop_id=destination.id,
        destination_shop_name=destination.name,
        source_product_id=source_product.id,
        source_product_name=source_product.name,
        destination_product_id=destination_product.id,
        destination_product_name=destination_product.name,
        quantity=transfer.quantity,
        delivery_terms=transfer.delivery_terms,
        status=transfer.status,
        events=[TradeTransferEventRead.model_validate(event) for event in events],
        documents=[TradeDocumentRead.model_validate(document) for document in documents],
        created_at=transfer.created_at,
        updated_at=transfer.updated_at,
    )


@router.get("/trade/listings", response_model=list[WholesaleListingRead])
async def search_wholesale_listings(
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=120)] = None,
    city: Annotated[str | None, Query(max_length=80)] = None,
    province: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[WholesaleListingRead]:
    statement = (
        select(WholesaleListing)
        .join(Product, Product.id == WholesaleListing.product_id)
        .join(Shop, Shop.id == WholesaleListing.shop_id)
        .where(
            WholesaleListing.is_active.is_(True),
            WholesaleListing.available_quantity >= WholesaleListing.minimum_order_quantity,
            Product.stock >= WholesaleListing.minimum_order_quantity,
            Product.status == "approved",
            Shop.is_active.is_(True),
        )
        .order_by(WholesaleListing.created_at.desc())
        .limit(limit)
    )
    if q and q.strip():
        term = f"%{q.strip()}%"
        statement = statement.where(
            or_(Product.name.ilike(term), Product.description.ilike(term), Shop.name.ilike(term))
        )
    if city:
        statement = statement.where(Shop.city.ilike(city.strip()))
    if province:
        statement = statement.where(Shop.province.ilike(province.strip()))
    listings = list(await session.scalars(statement))
    return [await _listing_read(session, listing) for listing in listings]


@router.post(
    "/vendor/trade/listings",
    response_model=WholesaleListingRead,
    status_code=201,
)
async def create_wholesale_listing(
    payload: WholesaleListingCreate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WholesaleListingRead:
    product = await session.scalar(
        select(Product)
        .where(Product.id == payload.product_id, Product.shop_id == shop.id)
        .with_for_update()
    )
    if product is None:
        raise APIError(
            404, "product_not_found", "Only your own product can be listed for wholesale."
        )
    if product.status != "approved":
        raise APIError(
            409, "product_not_approved", "Only approved products can be offered for wholesale."
        )
    if payload.available_quantity < payload.minimum_order_quantity:
        raise APIError(
            422,
            "wholesale_quantity_below_minimum",
            "Available quantity must meet the minimum order.",
        )
    if payload.available_quantity > product.stock:
        raise APIError(
            409,
            "wholesale_quantity_exceeds_stock",
            "Wholesale availability cannot exceed current stock.",
        )
    tier_quantities = [tier.minimum_quantity for tier in payload.price_tiers]
    if len(set(tier_quantities)) != len(tier_quantities) or any(
        quantity < payload.minimum_order_quantity for quantity in tier_quantities
    ):
        raise APIError(
            422,
            "invalid_wholesale_price_tiers",
            "Price tiers must be unique and cannot start below the minimum order quantity.",
        )
    existing = await session.scalar(
        select(WholesaleListing).where(WholesaleListing.product_id == product.id).with_for_update()
    )
    if existing is not None:
        if existing.is_active:
            raise APIError(
                409, "wholesale_listing_exists", "This product already has a wholesale listing."
            )
        existing.minimum_order_quantity = payload.minimum_order_quantity
        existing.available_quantity = payload.available_quantity
        existing.unit_label = payload.unit_label
        existing.is_active = True
        await session.execute(
            delete(WholesalePriceTier).where(WholesalePriceTier.listing_id == existing.id)
        )
        listing = existing
    else:
        listing = WholesaleListing(
            shop_id=shop.id,
            product_id=product.id,
            minimum_order_quantity=payload.minimum_order_quantity,
            available_quantity=payload.available_quantity,
            unit_label=payload.unit_label,
        )
    session.add(listing)
    try:
        await session.flush()
        session.add_all(
            [
                WholesalePriceTier(
                    listing_id=listing.id,
                    minimum_quantity=tier.minimum_quantity,
                    unit_price=tier.unit_price,
                )
                for tier in payload.price_tiers
            ]
        )
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "wholesale_listing_exists", "This product already has a wholesale listing."
        ) from None
    await session.refresh(listing)
    return await _listing_read(session, listing)


@router.put("/vendor/trade/listings/{listing_id}", response_model=WholesaleListingRead)
async def update_wholesale_listing(
    listing_id: UUID,
    payload: WholesaleListingCreate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> WholesaleListingRead:
    listing = await session.scalar(
        select(WholesaleListing).where(
            WholesaleListing.id == listing_id, WholesaleListing.shop_id == shop.id
        )
    )
    if listing is None:
        raise APIError(404, "wholesale_listing_not_found", "The wholesale listing was not found.")
    if payload.product_id != listing.product_id:
        raise APIError(
            422, "listing_product_immutable", "A listing cannot be moved to another product."
        )
    product = await session.scalar(
        select(Product).where(Product.id == listing.product_id).with_for_update()
    )
    listing = await session.scalar(
        select(WholesaleListing)
        .where(WholesaleListing.id == listing_id, WholesaleListing.shop_id == shop.id)
        .with_for_update()
    )
    if listing is None:
        raise APIError(404, "wholesale_listing_not_found", "The wholesale listing was not found.")
    if product is None or product.status != "approved":
        raise APIError(
            409, "product_not_approved", "Only approved products can be offered for wholesale."
        )
    if payload.available_quantity < payload.minimum_order_quantity:
        raise APIError(
            422,
            "wholesale_quantity_below_minimum",
            "Available quantity must meet the minimum order.",
        )
    if payload.available_quantity > product.stock:
        raise APIError(
            409,
            "wholesale_quantity_exceeds_stock",
            "Wholesale availability cannot exceed current stock.",
        )
    tier_quantities = [tier.minimum_quantity for tier in payload.price_tiers]
    if len(set(tier_quantities)) != len(tier_quantities) or any(
        quantity < payload.minimum_order_quantity for quantity in tier_quantities
    ):
        raise APIError(
            422,
            "invalid_wholesale_price_tiers",
            "Price tiers must be unique and cannot start below the minimum order quantity.",
        )
    listing.minimum_order_quantity = payload.minimum_order_quantity
    listing.available_quantity = payload.available_quantity
    listing.unit_label = payload.unit_label
    listing.is_active = True
    await session.execute(
        delete(WholesalePriceTier).where(WholesalePriceTier.listing_id == listing.id)
    )
    session.add_all(
        [
            WholesalePriceTier(
                listing_id=listing.id,
                minimum_quantity=tier.minimum_quantity,
                unit_price=tier.unit_price,
            )
            for tier in payload.price_tiers
        ]
    )
    await session.commit()
    await session.refresh(listing)
    return await _listing_read(session, listing)


@router.delete("/vendor/trade/listings/{listing_id}", status_code=204)
async def deactivate_wholesale_listing(
    listing_id: UUID,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    listing = await session.scalar(
        select(WholesaleListing).where(
            WholesaleListing.id == listing_id, WholesaleListing.shop_id == shop.id
        )
    )
    if listing is None:
        raise APIError(404, "wholesale_listing_not_found", "The wholesale listing was not found.")
    listing.is_active = False
    await session.commit()


@router.get("/vendor/trade/listings", response_model=list[WholesaleListingRead])
async def list_my_wholesale_listings(
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[WholesaleListingRead]:
    listings = list(
        await session.scalars(
            select(WholesaleListing)
            .where(WholesaleListing.shop_id == shop.id)
            .order_by(WholesaleListing.created_at.desc())
        )
    )
    return [await _listing_read(session, listing) for listing in listings]


@router.post("/trade/rfqs", response_model=TradeRFQRead, status_code=201)
async def create_trade_rfq(
    payload: TradeRFQCreate,
    buyer: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeRFQRead:
    listing = await session.scalar(
        select(WholesaleListing).where(WholesaleListing.id == payload.listing_id).with_for_update()
    )
    if listing is None or not listing.is_active:
        raise APIError(404, "wholesale_listing_not_found", "The wholesale listing is unavailable.")
    product = await session.get(Product, listing.product_id)
    seller = await session.get(Shop, listing.shop_id)
    if product is None or product.status != "approved" or seller is None or not seller.is_active:
        raise APIError(404, "wholesale_listing_not_found", "The wholesale listing is unavailable.")
    await _different_owners(session, buyer, seller.id)
    if payload.quantity < listing.minimum_order_quantity:
        raise APIError(
            422, "quantity_below_minimum", "The requested quantity is below the listing minimum."
        )
    if payload.quantity > min(listing.available_quantity, product.stock):
        raise APIError(
            409, "quantity_unavailable", "The requested quantity exceeds bulk availability."
        )
    if payload.requested_delivery_date and payload.requested_delivery_date < date.today():
        raise APIError(
            422, "delivery_date_in_past", "The requested delivery date cannot be in the past."
        )
    rfq = TradeRFQ(
        id=uuid4(),
        buyer_shop_id=buyer.id,
        seller_shop_id=listing.shop_id,
        listing_id=listing.id,
        quantity=payload.quantity,
        requested_delivery_date=payload.requested_delivery_date,
        delivery_terms=payload.delivery_terms,
        message=payload.message,
    )
    session.add(rfq)
    session.add(
        TradeNegotiationEvent(
            rfq_id=rfq.id,
            actor_shop_id=buyer.id,
            note=payload.message,
        )
    )
    await session.commit()
    await session.refresh(rfq)
    return await _rfq_read(session, rfq)


@router.get("/trade/rfqs", response_model=list[TradeRFQRead])
async def list_trade_rfqs(
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TradeRFQRead]:
    rfqs = list(
        await session.scalars(
            select(TradeRFQ)
            .where(or_(TradeRFQ.buyer_shop_id == shop.id, TradeRFQ.seller_shop_id == shop.id))
            .order_by(TradeRFQ.created_at.desc())
        )
    )
    return [await _rfq_read(session, rfq) for rfq in rfqs]


@router.post("/trade/rfqs/{rfq_id}/quotes", response_model=TradeRFQRead, status_code=201)
async def submit_trade_quote(
    rfq_id: UUID,
    payload: TradeQuoteCreate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeRFQRead:
    rfq = await session.scalar(select(TradeRFQ).where(TradeRFQ.id == rfq_id).with_for_update())
    if rfq is None or rfq.seller_shop_id != shop.id:
        raise APIError(404, "trade_rfq_not_found", "The request for quotation was not found.")
    if rfq.status not in {"open", "quoted"}:
        raise APIError(409, "trade_rfq_closed", "This request for quotation is no longer open.")
    if payload.quantity != rfq.quantity:
        raise APIError(
            422, "quote_quantity_mismatch", "A quote must cover the quantity requested in the RFQ."
        )
    if payload.valid_until is not None:
        if payload.valid_until.tzinfo is None or payload.valid_until <= datetime.now(timezone.utc):
            raise APIError(
                422, "quote_expiry_invalid", "Quote expiry must be a future timezone-aware date."
            )
    previous_quotes = list(
        await session.scalars(
            select(TradeQuote).where(TradeQuote.rfq_id == rfq.id).with_for_update()
        )
    )
    revision = max((quote.revision for quote in previous_quotes), default=0) + 1
    for previous in previous_quotes:
        if previous.status == "pending":
            previous.status = "superseded"
    quote = TradeQuote(
        rfq_id=rfq.id,
        revision=revision,
        quantity=payload.quantity,
        unit_price=payload.unit_price,
        delivery_terms=payload.delivery_terms,
        valid_until=payload.valid_until,
    )
    session.add(quote)
    await session.flush()
    session.add(
        TradeNegotiationEvent(
            rfq_id=rfq.id,
            quote_id=quote.id,
            actor_shop_id=shop.id,
            note=payload.note,
        )
    )
    rfq.status = "quoted"
    await session.commit()
    await session.refresh(rfq)
    return await _rfq_read(session, rfq)


@router.post(
    "/trade/quotes/{quote_id}/accept", response_model=TradePurchaseOrderRead, status_code=201
)
async def accept_trade_quote(
    quote_id: UUID,
    buyer: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradePurchaseOrderRead:
    quote_reference = await session.scalar(select(TradeQuote).where(TradeQuote.id == quote_id))
    if quote_reference is None:
        raise APIError(404, "trade_quote_not_found", "The quote was not found.")
    rfq = await session.scalar(
        select(TradeRFQ).where(TradeRFQ.id == quote_reference.rfq_id).with_for_update()
    )
    quote = await session.scalar(
        select(TradeQuote)
        .where(TradeQuote.id == quote_id, TradeQuote.rfq_id == quote_reference.rfq_id)
        .with_for_update()
    )
    if rfq is None or rfq.buyer_shop_id != buyer.id:
        raise APIError(404, "trade_quote_not_found", "The quote was not found.")
    await _different_owners(session, buyer, rfq.seller_shop_id)
    if quote is None:
        raise APIError(404, "trade_quote_not_found", "The quote was not found.")
    if rfq.status not in {"open", "quoted"} or quote.status != "pending":
        raise APIError(409, "trade_quote_not_pending", "This quote cannot be accepted.")
    if quote.valid_until is not None:
        expiry = quote.valid_until
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry <= datetime.now(timezone.utc):
            raise APIError(409, "trade_quote_expired", "This quote has expired.")
    order = TradePurchaseOrder(
        id=uuid4(),
        rfq_id=rfq.id,
        quote_id=quote.id,
        buyer_shop_id=buyer.id,
        seller_shop_id=rfq.seller_shop_id,
        listing_id=rfq.listing_id,
        order_number=f"VPO-{uuid4().hex[:12].upper()}",
        quantity=quote.quantity,
        unit_price=quote.unit_price,
        total=quote.unit_price * quote.quantity,
        delivery_terms=quote.delivery_terms,
        status="placed",
    )
    session.add(order)
    quote.status = "accepted"
    rfq.status = "accepted"
    await session.flush()
    session.add(
        TradeOrderEvent(
            order_id=order.id,
            actor_shop_id=buyer.id,
            from_status=None,
            to_status="placed",
            note="Purchase order created from an accepted quotation.",
        )
    )
    await session.commit()
    await session.refresh(order)
    return await _purchase_order_read(session, order)


@router.post("/trade/quotes/{quote_id}/reject", response_model=TradeRFQRead)
async def reject_trade_quote(
    quote_id: UUID,
    buyer: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeRFQRead:
    quote_reference = await session.scalar(select(TradeQuote).where(TradeQuote.id == quote_id))
    if quote_reference is None:
        raise APIError(404, "trade_quote_not_found", "The quote was not found.")
    rfq = await session.scalar(
        select(TradeRFQ).where(TradeRFQ.id == quote_reference.rfq_id).with_for_update()
    )
    quote = await session.scalar(
        select(TradeQuote)
        .where(TradeQuote.id == quote_id, TradeQuote.rfq_id == quote_reference.rfq_id)
        .with_for_update()
    )
    if (
        rfq is None
        or quote is None
        or rfq.buyer_shop_id != buyer.id
        or rfq.status not in {"open", "quoted"}
        or quote.status != "pending"
    ):
        raise APIError(404, "trade_quote_not_found", "The quote was not found.")
    quote.status = "rejected"
    pending_quote = await session.scalar(
        select(TradeQuote.id).where(
            TradeQuote.rfq_id == rfq.id,
            TradeQuote.status == "pending",
            TradeQuote.id != quote.id,
        )
    )
    rfq.status = "quoted" if pending_quote else "open"
    session.add(
        TradeNegotiationEvent(
            rfq_id=rfq.id,
            quote_id=quote.id,
            actor_shop_id=buyer.id,
            note="The buyer declined this quotation.",
        )
    )
    await session.commit()
    await session.refresh(rfq)
    return await _rfq_read(session, rfq)


@router.get("/trade/orders", response_model=list[TradePurchaseOrderRead])
async def list_trade_purchase_orders(
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TradePurchaseOrderRead]:
    orders = list(
        await session.scalars(
            select(TradePurchaseOrder)
            .where(
                or_(
                    TradePurchaseOrder.buyer_shop_id == shop.id,
                    TradePurchaseOrder.seller_shop_id == shop.id,
                )
            )
            .order_by(TradePurchaseOrder.created_at.desc())
        )
    )
    return [await _purchase_order_read(session, order) for order in orders]


@router.post("/trade/orders/{order_id}/status", response_model=TradePurchaseOrderRead)
async def update_trade_order_status(
    order_id: UUID,
    payload: TradeStatusUpdate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradePurchaseOrderRead:
    order = await session.scalar(
        select(TradePurchaseOrder).where(TradePurchaseOrder.id == order_id).with_for_update()
    )
    if order is None or shop.id not in {order.buyer_shop_id, order.seller_shop_id}:
        raise APIError(404, "trade_order_not_found", "The purchase order was not found.")
    previous = order.status
    allowed = (
        (previous == "placed" and payload.status == "confirmed" and shop.id == order.seller_shop_id)
        or (
            previous == "placed"
            and payload.status == "cancelled"
            and shop.id in {order.buyer_shop_id, order.seller_shop_id}
        )
        or (
            previous == "confirmed"
            and payload.status == "shipped"
            and shop.id == order.seller_shop_id
        )
        or (
            previous == "confirmed"
            and payload.status == "cancelled"
            and shop.id in {order.buyer_shop_id, order.seller_shop_id}
        )
        or (
            previous == "shipped"
            and payload.status == "received"
            and shop.id == order.buyer_shop_id
        )
    )
    if not allowed:
        raise APIError(
            409,
            "trade_order_transition_invalid",
            "This purchase order status transition is not allowed.",
        )

    if payload.status == "confirmed":
        current_listing = await session.get(WholesaleListing, order.listing_id)
        product = (
            await session.scalar(
                select(Product).where(Product.id == current_listing.product_id).with_for_update()
            )
            if current_listing
            else None
        )
        listing = await session.scalar(
            select(WholesaleListing)
            .where(WholesaleListing.id == order.listing_id)
            .with_for_update()
        )
        if listing is None or product is None or not listing.is_active:
            raise APIError(
                409, "trade_listing_unavailable", "The wholesale listing is unavailable."
            )
        if product.status != "approved":
            raise APIError(
                409, "trade_product_unavailable", "The trade product is no longer approved."
            )
        if listing.available_quantity < order.quantity or product.stock < order.quantity:
            raise APIError(
                409, "trade_stock_unavailable", "There is not enough stock to confirm this order."
            )
        listing.available_quantity -= order.quantity
        product.stock -= order.quantity
        order.inventory_reserved = True
    elif payload.status == "cancelled" and order.inventory_reserved:
        current_listing = await session.get(WholesaleListing, order.listing_id)
        product = (
            await session.scalar(
                select(Product).where(Product.id == current_listing.product_id).with_for_update()
            )
            if current_listing
            else None
        )
        listing = await session.scalar(
            select(WholesaleListing)
            .where(WholesaleListing.id == order.listing_id)
            .with_for_update()
        )
        if listing is None or product is None:
            raise APIError(
                409, "trade_listing_unavailable", "The reserved wholesale stock cannot be restored."
            )
        if product.stock + order.quantity > 2_147_483_647:
            raise APIError(
                409,
                "trade_stock_limit",
                "Restoring reserved stock would exceed the product stock limit.",
            )
        listing.available_quantity += order.quantity
        product.stock += order.quantity
        order.inventory_reserved = False

    order.status = payload.status
    session.add(
        TradeOrderEvent(
            order_id=order.id,
            actor_shop_id=shop.id,
            from_status=previous,
            to_status=payload.status,
            note=payload.note,
        )
    )
    await session.commit()
    await session.refresh(order)
    return await _purchase_order_read(session, order)


@router.post("/trade/rfqs/{rfq_id}/cancel", response_model=TradeRFQRead)
async def cancel_trade_rfq(
    rfq_id: UUID,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeRFQRead:
    rfq = await session.scalar(select(TradeRFQ).where(TradeRFQ.id == rfq_id).with_for_update())
    if rfq is None or rfq.buyer_shop_id != shop.id:
        raise APIError(404, "trade_rfq_not_found", "The request for quotation was not found.")
    if rfq.status not in {"open", "quoted"}:
        raise APIError(
            409, "trade_rfq_closed", "This request for quotation can no longer be cancelled."
        )
    rfq.status = "cancelled"
    session.add(
        TradeNegotiationEvent(
            rfq_id=rfq.id, actor_shop_id=shop.id, note="The buyer cancelled this request."
        )
    )
    await session.commit()
    await session.refresh(rfq)
    return await _rfq_read(session, rfq)


@router.post("/trade/rfqs/{rfq_id}/decline", response_model=TradeRFQRead)
async def decline_trade_rfq(
    rfq_id: UUID,
    payload: TradeNegotiationNote,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeRFQRead:
    rfq = await session.scalar(select(TradeRFQ).where(TradeRFQ.id == rfq_id).with_for_update())
    if rfq is None or rfq.seller_shop_id != shop.id:
        raise APIError(404, "trade_rfq_not_found", "The request for quotation was not found.")
    if rfq.status not in {"open", "quoted"}:
        raise APIError(
            409, "trade_rfq_closed", "This request for quotation can no longer be declined."
        )
    rfq.status = "declined"
    quotes = list(
        await session.scalars(
            select(TradeQuote).where(TradeQuote.rfq_id == rfq.id).with_for_update()
        )
    )
    for quote in quotes:
        if quote.status == "pending":
            quote.status = "rejected"
    session.add(
        TradeNegotiationEvent(
            rfq_id=rfq.id,
            actor_shop_id=shop.id,
            note=payload.note or "The supplier declined this request for quotation.",
        )
    )
    await session.commit()
    await session.refresh(rfq)
    return await _rfq_read(session, rfq)


@router.get("/trade/suppliers", response_model=list[TradeSupplierRead])
async def search_trade_suppliers(
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=120)] = None,
    city: Annotated[str | None, Query(max_length=80)] = None,
    province: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[TradeSupplierRead]:
    statement = select(Shop).where(
        Shop.is_active.is_(True),
        Shop.id.in_(
            select(WholesaleListing.shop_id)
            .join(Product, Product.id == WholesaleListing.product_id)
            .where(
                WholesaleListing.is_active.is_(True),
                WholesaleListing.available_quantity >= WholesaleListing.minimum_order_quantity,
                Product.stock >= WholesaleListing.minimum_order_quantity,
                Product.status == "approved",
            )
        ),
    )
    if q and q.strip():
        term = f"%{q.strip()}%"
        statement = statement.where(
            or_(
                Shop.name.ilike(term),
                Shop.city.ilike(term),
                Shop.province.ilike(term),
                Shop.id.in_(
                    select(WholesaleListing.shop_id)
                    .join(Product, Product.id == WholesaleListing.product_id)
                    .where(
                        WholesaleListing.is_active.is_(True),
                        WholesaleListing.available_quantity
                        >= WholesaleListing.minimum_order_quantity,
                        Product.stock >= WholesaleListing.minimum_order_quantity,
                        Product.status == "approved",
                        or_(Product.name.ilike(term), Product.description.ilike(term)),
                    )
                ),
            )
        )
    if city:
        statement = statement.where(Shop.city.ilike(city.strip()))
    if province:
        statement = statement.where(Shop.province.ilike(province.strip()))
    shops = list(await session.scalars(statement.order_by(Shop.name).limit(limit)))
    result: list[TradeSupplierRead] = []
    for shop in shops:
        listing_count = await session.scalar(
            select(func.count(WholesaleListing.id))
            .join(Product, Product.id == WholesaleListing.product_id)
            .where(
                WholesaleListing.shop_id == shop.id,
                WholesaleListing.is_active.is_(True),
                WholesaleListing.available_quantity >= WholesaleListing.minimum_order_quantity,
                Product.stock >= WholesaleListing.minimum_order_quantity,
                Product.status == "approved",
            )
        )
        completed_count = await session.scalar(
            select(func.count(TradePurchaseOrder.id)).where(
                TradePurchaseOrder.seller_shop_id == shop.id,
                TradePurchaseOrder.status == "received",
            )
        )
        average_rating = await session.scalar(
            select(func.avg(TradeBusinessReview.rating)).where(
                TradeBusinessReview.supplier_shop_id == shop.id
            )
        )
        reviews = list(
            await session.scalars(
                select(TradeBusinessReview)
                .where(TradeBusinessReview.supplier_shop_id == shop.id)
                .order_by(TradeBusinessReview.created_at.desc())
                .limit(10)
            )
        )
        result.append(
            TradeSupplierRead(
                shop_id=shop.id,
                shop_name=shop.name,
                shop_slug=shop.slug,
                city=shop.city,
                province=shop.province,
                active_listing_count=int(listing_count or 0),
                completed_trade_count=int(completed_count or 0),
                average_rating=Decimal(str(average_rating)) if average_rating is not None else None,
                reviews=[TradeBusinessReviewRead.model_validate(review) for review in reviews],
            )
        )
    return result


@router.get("/trade/history", response_model=list[TradePurchaseOrderRead])
async def list_my_trade_history(
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TradePurchaseOrderRead]:
    orders = list(
        await session.scalars(
            select(TradePurchaseOrder)
            .where(
                or_(
                    TradePurchaseOrder.buyer_shop_id == shop.id,
                    TradePurchaseOrder.seller_shop_id == shop.id,
                )
            )
            .order_by(TradePurchaseOrder.created_at.desc())
        )
    )
    return [await _purchase_order_read(session, order) for order in orders]


@router.post(
    "/trade/orders/{order_id}/reviews",
    response_model=TradeBusinessReviewRead,
    status_code=201,
)
async def review_trade_supplier(
    order_id: UUID,
    payload: TradeBusinessReviewCreate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeBusinessReviewRead:
    order = await session.scalar(
        select(TradePurchaseOrder).where(TradePurchaseOrder.id == order_id)
    )
    if order is None or order.buyer_shop_id != shop.id:
        raise APIError(404, "trade_order_not_found", "The purchase order was not found.")
    await _different_owners(session, shop, order.seller_shop_id)
    if order.status != "received":
        raise APIError(
            409, "trade_order_not_received", "A supplier review requires confirmed receipt."
        )
    review = TradeBusinessReview(
        order_id=order.id,
        reviewer_shop_id=shop.id,
        supplier_shop_id=order.seller_shop_id,
        rating=payload.rating,
        body=payload.body,
    )
    session.add(review)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "trade_review_exists", "A review has already been submitted for this purchase."
        ) from None
    await session.refresh(review)
    return TradeBusinessReviewRead.model_validate(review)


@router.post(
    "/trade/transfers",
    response_model=TradeStockTransferRead,
    status_code=201,
)
async def create_stock_transfer(
    payload: TradeStockTransferCreate,
    source_shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeStockTransferRead:
    if payload.destination_shop_id == source_shop.id:
        raise APIError(422, "self_transfer_not_allowed", "A shop cannot transfer stock to itself.")
    destination = await session.scalar(
        select(Shop).where(Shop.id == payload.destination_shop_id, Shop.is_active.is_(True))
    )
    if destination is None:
        raise APIError(404, "destination_shop_not_found", "The receiving shop was not found.")
    source_product = await session.scalar(
        select(Product).where(
            Product.id == payload.source_product_id,
            Product.shop_id == source_shop.id,
            Product.status == "approved",
        )
    )
    destination_product = await session.scalar(
        select(Product).where(
            Product.id == payload.destination_product_id,
            Product.shop_id == destination.id,
            Product.status == "approved",
        )
    )
    if source_product is None or destination_product is None:
        raise APIError(
            404,
            "transfer_product_not_found",
            "Both approved products must belong to their respective shops.",
        )
    if source_product.category_id != destination_product.category_id:
        raise APIError(
            422,
            "transfer_product_mismatch",
            "Transferred products must use the same catalogue category.",
        )
    if source_product.stock < payload.quantity:
        raise APIError(
            409, "transfer_stock_unavailable", "The source shop does not have enough stock."
        )
    transfer = TradeStockTransfer(
        id=uuid4(),
        source_shop_id=source_shop.id,
        destination_shop_id=destination.id,
        source_product_id=source_product.id,
        destination_product_id=destination_product.id,
        quantity=payload.quantity,
        delivery_terms=payload.delivery_terms,
    )
    session.add(transfer)
    await session.flush()
    session.add(
        TradeTransferEvent(
            transfer_id=transfer.id,
            actor_shop_id=source_shop.id,
            from_status=None,
            to_status="requested",
            note="Stock transfer requested.",
        )
    )
    await session.commit()
    await session.refresh(transfer)
    return await _transfer_read(session, transfer)


@router.get("/trade/transfers", response_model=list[TradeStockTransferRead])
async def list_stock_transfers(
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TradeStockTransferRead]:
    transfers = list(
        await session.scalars(
            select(TradeStockTransfer)
            .where(
                or_(
                    TradeStockTransfer.source_shop_id == shop.id,
                    TradeStockTransfer.destination_shop_id == shop.id,
                )
            )
            .order_by(TradeStockTransfer.created_at.desc())
        )
    )
    return [await _transfer_read(session, transfer) for transfer in transfers]


@router.post("/trade/transfers/{transfer_id}/status", response_model=TradeStockTransferRead)
async def update_stock_transfer_status(
    transfer_id: UUID,
    payload: TradeStatusUpdate,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TradeStockTransferRead:
    transfer = await session.scalar(
        select(TradeStockTransfer).where(TradeStockTransfer.id == transfer_id).with_for_update()
    )
    if transfer is None or shop.id not in {transfer.source_shop_id, transfer.destination_shop_id}:
        raise APIError(404, "trade_transfer_not_found", "The stock transfer was not found.")
    previous = transfer.status
    allowed = (
        (
            previous == "requested"
            and payload.status in {"approved", "rejected"}
            and shop.id == transfer.destination_shop_id
        )
        or (
            previous in {"requested", "approved"}
            and payload.status == "cancelled"
            and shop.id == transfer.source_shop_id
        )
        or (
            previous == "approved"
            and payload.status == "shipped"
            and shop.id == transfer.source_shop_id
        )
        or (
            previous == "shipped"
            and payload.status == "received"
            and shop.id == transfer.destination_shop_id
        )
    )
    if not allowed:
        raise APIError(
            409,
            "trade_transfer_transition_invalid",
            "This stock transfer status transition is not allowed.",
        )
    if payload.status == "shipped":
        product_ids = sorted([transfer.source_product_id, transfer.destination_product_id], key=str)
        products = list(
            await session.scalars(
                select(Product)
                .where(Product.id.in_(product_ids))
                .order_by(Product.id)
                .with_for_update()
            )
        )
        by_id = {product.id: product for product in products}
        source_product = by_id.get(transfer.source_product_id)
        destination_product = by_id.get(transfer.destination_product_id)
        if source_product is None or destination_product is None:
            raise APIError(
                409, "transfer_product_unavailable", "A product in this transfer is unavailable."
            )
        if (
            source_product.stock < transfer.quantity
            or source_product.status != "approved"
            or destination_product.status != "approved"
        ):
            raise APIError(
                409, "transfer_stock_unavailable", "The source shop no longer has enough stock."
            )
        source_product.stock -= transfer.quantity
        listings = list(
            await session.scalars(
                select(WholesaleListing)
                .where(
                    WholesaleListing.product_id == source_product.id,
                    WholesaleListing.is_active.is_(True),
                )
                .with_for_update()
            )
        )
        for listing in listings:
            listing.available_quantity = max(0, listing.available_quantity - transfer.quantity)
    elif payload.status == "received":
        destination_product = await session.scalar(
            select(Product).where(Product.id == transfer.destination_product_id).with_for_update()
        )
        if destination_product is None:
            raise APIError(
                409, "transfer_product_unavailable", "The receiving product is unavailable."
            )
        if destination_product.stock + transfer.quantity > 2_147_483_647:
            raise APIError(
                409, "transfer_stock_limit", "The receiving product stock limit would be exceeded."
            )
        destination_product.stock += transfer.quantity
        destination_listings = list(
            await session.scalars(
                select(WholesaleListing)
                .where(
                    WholesaleListing.product_id == destination_product.id,
                    WholesaleListing.is_active.is_(True),
                )
                .with_for_update()
            )
        )
        for listing in destination_listings:
            listing.available_quantity = min(
                listing.available_quantity + transfer.quantity, destination_product.stock
            )

    transfer.status = payload.status
    session.add(
        TradeTransferEvent(
            transfer_id=transfer.id,
            actor_shop_id=shop.id,
            from_status=previous,
            to_status=payload.status,
            note=payload.note,
        )
    )
    await session.commit()
    await session.refresh(transfer)
    return await _transfer_read(session, transfer)


async def _trade_document_parent(
    session: AsyncSession,
    shop: Shop,
    *,
    order_id: UUID | None = None,
    transfer_id: UUID | None = None,
) -> tuple[UUID, UUID | None, UUID | None]:
    if order_id is not None:
        order = await session.scalar(
            select(TradePurchaseOrder).where(
                TradePurchaseOrder.id == order_id,
                or_(
                    TradePurchaseOrder.buyer_shop_id == shop.id,
                    TradePurchaseOrder.seller_shop_id == shop.id,
                ),
            )
        )
        if order is None:
            raise APIError(404, "trade_order_not_found", "The purchase order was not found.")
        return shop.id, order.id, None
    if transfer_id is not None:
        transfer = await session.scalar(
            select(TradeStockTransfer).where(
                TradeStockTransfer.id == transfer_id,
                or_(
                    TradeStockTransfer.source_shop_id == shop.id,
                    TradeStockTransfer.destination_shop_id == shop.id,
                ),
            )
        )
        if transfer is None:
            raise APIError(404, "trade_transfer_not_found", "The stock transfer was not found.")
        return shop.id, None, transfer.id
    raise APIError(
        422, "trade_document_parent_required", "A purchase order or transfer is required."
    )


async def _upload_trade_document(
    *,
    shop: Shop,
    session: AsyncSession,
    file: UploadFile,
    order_id: UUID | None = None,
    transfer_id: UUID | None = None,
) -> TradeDocumentRead:
    uploader_shop_id, parent_order_id, parent_transfer_id = await _trade_document_parent(
        session, shop, order_id=order_id, transfer_id=transfer_id
    )
    contents = await file.read(MAX_TRADE_DOCUMENT_SIZE + 1)
    if not contents or len(contents) > MAX_TRADE_DOCUMENT_SIZE:
        raise APIError(
            413, "trade_document_size_invalid", "Trade documents must be between 1 byte and 10 MB."
        )
    content_type = next(
        (
            mime_type
            for mime_type, (_, signature) in TRADE_DOCUMENT_TYPES.items()
            if contents.startswith(signature)
        ),
        None,
    )
    if content_type is None:
        raise APIError(
            415, "trade_document_type_unsupported", "Upload a PDF, PNG, or JPEG document."
        )
    extension = TRADE_DOCUMENT_TYPES[content_type][0]
    original_filename = (
        re.sub(
            r"[\x00-\x1f\x7f]",
            "",
            PurePath((file.filename or "trade-document").replace("\\", "/")).name,
        )[:255]
        or "trade-document"
    )
    parent_key = str(parent_order_id or parent_transfer_id)
    object_name = f"trade-documents/{parent_key}/{uuid4().hex}{extension}"
    settings = get_settings()
    try:
        await run_in_threadpool(
            get_minio_client().put_object,
            settings.minio_private_bucket,
            object_name,
            BytesIO(contents),
            len(contents),
            content_type=content_type,
        )
    except (S3Error, OSError):
        logger.exception("Private trade document upload failed")
        raise APIError(
            503, "trade_storage_unavailable", "Trade document storage is unavailable."
        ) from None
    document = TradeDocument(
        purchase_order_id=parent_order_id,
        transfer_id=parent_transfer_id,
        uploader_shop_id=uploader_shop_id,
        original_filename=original_filename,
        object_name=object_name,
        content_type=content_type,
        file_size=len(contents),
    )
    session.add(document)
    try:
        await session.commit()
    except SQLAlchemyError:
        await session.rollback()
        try:
            await run_in_threadpool(
                get_minio_client().remove_object, settings.minio_private_bucket, object_name
            )
        except (S3Error, OSError):
            logger.exception("Unreferenced private trade document cleanup failed")
        raise
    await session.refresh(document)
    return TradeDocumentRead.model_validate(document)


@router.post(
    "/trade/orders/{order_id}/documents",
    response_model=TradeDocumentRead,
    status_code=201,
)
async def upload_order_document(
    order_id: UUID,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> TradeDocumentRead:
    return await _upload_trade_document(shop=shop, session=session, file=file, order_id=order_id)


@router.post(
    "/trade/transfers/{transfer_id}/documents",
    response_model=TradeDocumentRead,
    status_code=201,
)
async def upload_transfer_document(
    transfer_id: UUID,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
    file: Annotated[UploadFile, File()],
) -> TradeDocumentRead:
    return await _upload_trade_document(
        shop=shop, session=session, file=file, transfer_id=transfer_id
    )


@router.get("/trade/documents/{document_id}/url")
async def get_trade_document_url(
    document_id: UUID,
    shop: Annotated[Shop, Depends(get_active_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, str | int]:
    document = await session.scalar(select(TradeDocument).where(TradeDocument.id == document_id))
    if document is None:
        raise APIError(404, "trade_document_not_found", "The trade document was not found.")
    if document.purchase_order_id is not None:
        order = await session.get(TradePurchaseOrder, document.purchase_order_id)
        allowed = order is not None and shop.id in {order.buyer_shop_id, order.seller_shop_id}
    else:
        transfer = await session.get(TradeStockTransfer, document.transfer_id)
        allowed = transfer is not None and shop.id in {
            transfer.source_shop_id,
            transfer.destination_shop_id,
        }
    if not allowed:
        raise APIError(404, "trade_document_not_found", "The trade document was not found.")
    settings = get_settings()
    try:
        url = await run_in_threadpool(
            get_minio_client().presigned_get_object,
            settings.minio_private_bucket,
            document.object_name,
            timedelta(minutes=5),
        )
    except (S3Error, OSError):
        logger.exception("Private trade document URL could not be created")
        raise APIError(
            503, "trade_storage_unavailable", "Trade document storage is unavailable."
        ) from None
    return {"url": url, "expires_in_seconds": 300}


@router.get("/trade/suppliers/{shop_id}/reviews", response_model=list[TradeBusinessReviewRead])
async def list_supplier_reviews(
    shop_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[TradeBusinessReviewRead]:
    shop = await session.get(Shop, shop_id)
    if shop is None or not shop.is_active:
        raise APIError(404, "supplier_not_found", "The supplier was not found.")
    reviews = list(
        await session.scalars(
            select(TradeBusinessReview)
            .where(TradeBusinessReview.supplier_shop_id == shop.id)
            .order_by(TradeBusinessReview.created_at.desc())
        )
    )
    return [TradeBusinessReviewRead.model_validate(review) for review in reviews]
