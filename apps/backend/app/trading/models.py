from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WholesaleListing(Base):
    __tablename__ = "wholesale_listings"
    __table_args__ = (
        CheckConstraint("minimum_order_quantity > 0", name="ck_wholesale_listings_minimum"),
        CheckConstraint("available_quantity >= 0", name="ck_wholesale_listings_available"),
        CheckConstraint("unit_label <> ''", name="ck_wholesale_listings_unit_label"),
        UniqueConstraint("product_id", name="uq_wholesale_listings_product"),
        Index("ix_wholesale_listings_search", "is_active", "shop_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    minimum_order_quantity: Mapped[int] = mapped_column(Integer)
    available_quantity: Mapped[int] = mapped_column(Integer)
    unit_label: Mapped[str] = mapped_column(String(40), default="piece", server_default="piece")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WholesalePriceTier(Base):
    __tablename__ = "wholesale_price_tiers"
    __table_args__ = (
        CheckConstraint("minimum_quantity > 0", name="ck_wholesale_price_tiers_minimum"),
        CheckConstraint("unit_price > 0", name="ck_wholesale_price_tiers_price"),
        UniqueConstraint(
            "listing_id", "minimum_quantity", name="uq_wholesale_price_tiers_quantity"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    listing_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("wholesale_listings.id", ondelete="CASCADE"), index=True
    )
    minimum_quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))


class TradeRFQ(Base):
    __tablename__ = "trade_rfqs"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_trade_rfqs_quantity"),
        CheckConstraint(
            "status IN ('open', 'quoted', 'accepted', 'declined', 'cancelled')",
            name="ck_trade_rfqs_status",
        ),
        Index("ix_trade_rfqs_buyer_created", "buyer_shop_id", "created_at"),
        Index("ix_trade_rfqs_seller_created", "seller_shop_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    buyer_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    seller_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    listing_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("wholesale_listings.id", ondelete="RESTRICT"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    requested_delivery_date: Mapped[date | None] = mapped_column(Date)
    delivery_terms: Mapped[str] = mapped_column(String(1000))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TradeQuote(Base):
    __tablename__ = "trade_quotes"
    __table_args__ = (
        CheckConstraint("revision > 0 AND quantity > 0", name="ck_trade_quotes_revision_quantity"),
        CheckConstraint("unit_price > 0", name="ck_trade_quotes_price"),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'rejected', 'superseded')",
            name="ck_trade_quotes_status",
        ),
        UniqueConstraint("rfq_id", "revision", name="uq_trade_quotes_revision"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rfq_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_rfqs.id", ondelete="CASCADE"), index=True
    )
    revision: Mapped[int] = mapped_column(Integer)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    delivery_terms: Mapped[str] = mapped_column(String(1000))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TradeNegotiationEvent(Base):
    __tablename__ = "trade_negotiation_events"
    __table_args__ = (
        CheckConstraint("length(note) > 0", name="ck_trade_negotiation_events_note"),
        Index("ix_trade_negotiation_events_rfq_created", "rfq_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rfq_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_rfqs.id", ondelete="CASCADE"), index=True
    )
    quote_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_quotes.id", ondelete="SET NULL")
    )
    actor_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TradePurchaseOrder(Base):
    __tablename__ = "trade_purchase_orders"
    __table_args__ = (
        CheckConstraint(
            "quantity > 0 AND unit_price > 0 AND total > 0",
            name="ck_trade_purchase_orders_amounts",
        ),
        CheckConstraint(
            "status IN ('placed', 'confirmed', 'shipped', 'received', 'cancelled')",
            name="ck_trade_purchase_orders_status",
        ),
        UniqueConstraint("quote_id", name="uq_trade_purchase_orders_quote"),
        Index("ix_trade_purchase_orders_buyer_created", "buyer_shop_id", "created_at"),
        Index("ix_trade_purchase_orders_seller_created", "seller_shop_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    rfq_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_rfqs.id", ondelete="RESTRICT"), index=True
    )
    quote_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_quotes.id", ondelete="RESTRICT")
    )
    buyer_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    seller_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    listing_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("wholesale_listings.id", ondelete="RESTRICT"), index=True
    )
    order_number: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    delivery_terms: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), default="placed", server_default="placed")
    inventory_reserved: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TradeOrderEvent(Base):
    __tablename__ = "trade_order_events"
    __table_args__ = (Index("ix_trade_order_events_order_created", "order_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_purchase_orders.id", ondelete="CASCADE"), index=True
    )
    actor_shop_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="SET NULL")
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TradeStockTransfer(Base):
    __tablename__ = "trade_stock_transfers"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_trade_stock_transfers_quantity"),
        CheckConstraint(
            "status IN ('requested', 'approved', 'rejected', 'shipped', 'received', 'cancelled')",
            name="ck_trade_stock_transfers_status",
        ),
        CheckConstraint(
            "source_shop_id <> destination_shop_id", name="ck_trade_stock_transfers_shops"
        ),
        Index("ix_trade_stock_transfers_source_created", "source_shop_id", "created_at"),
        Index("ix_trade_stock_transfers_destination_created", "destination_shop_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    source_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    destination_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    source_product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="RESTRICT")
    )
    destination_product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="RESTRICT")
    )
    quantity: Mapped[int] = mapped_column(Integer)
    delivery_terms: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), default="requested", server_default="requested")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TradeTransferEvent(Base):
    __tablename__ = "trade_transfer_events"
    __table_args__ = (
        Index("ix_trade_transfer_events_transfer_created", "transfer_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    transfer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_stock_transfers.id", ondelete="CASCADE"), index=True
    )
    actor_shop_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="SET NULL")
    )
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TradeDocument(Base):
    __tablename__ = "trade_documents"
    __table_args__ = (
        CheckConstraint(
            "(purchase_order_id IS NOT NULL AND transfer_id IS NULL) OR "
            "(purchase_order_id IS NULL AND transfer_id IS NOT NULL)",
            name="ck_trade_documents_exactly_one_parent",
        ),
        CheckConstraint("file_size > 0", name="ck_trade_documents_file_size"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    purchase_order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_purchase_orders.id", ondelete="CASCADE"), index=True
    )
    transfer_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_stock_transfers.id", ondelete="CASCADE"), index=True
    )
    uploader_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    object_name: Mapped[str] = mapped_column(String(240), unique=True)
    content_type: Mapped[str] = mapped_column(String(80))
    file_size: Mapped[int] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TradeBusinessReview(Base):
    __tablename__ = "trade_business_reviews"
    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_trade_business_reviews_rating"),
        CheckConstraint("length(body) > 0", name="ck_trade_business_reviews_body"),
        UniqueConstraint("order_id", name="uq_trade_business_reviews_order"),
        Index("ix_trade_business_reviews_supplier_created", "supplier_shop_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("trade_purchase_orders.id", ondelete="CASCADE"), index=True
    )
    reviewer_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    supplier_shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
