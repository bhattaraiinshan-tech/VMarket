from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
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


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_cart_items_quantity_positive"),
        Index("ix_cart_items_user_created", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("product_variants.id", ondelete="CASCADE"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CustomerOrder(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "subtotal >= 0 AND shipping_total >= 0 AND total >= 0",
            name="ck_orders_amounts_nonnegative",
        ),
        CheckConstraint("payment_method = 'cash_on_delivery'", name="ck_orders_payment_method"),
        CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'partially_cancelled', "
            "'cancelled', 'return_requested', 'returned')",
            name="ck_orders_status",
        ),
        UniqueConstraint("customer_id", "idempotency_key", name="uq_orders_customer_idempotency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    customer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    order_number: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    invoice_number: Mapped[str] = mapped_column(String(48), unique=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    address_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("delivery_addresses.id", ondelete="SET NULL")
    )
    shipping_address: Mapped[dict[str, str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending")
    payment_method: Mapped[str] = mapped_column(
        String(32), default="cash_on_delivery", server_default="cash_on_delivery"
    )
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    shipping_total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FulfillmentOrder(Base):
    __tablename__ = "fulfillment_orders"
    __table_args__ = (
        CheckConstraint(
            "subtotal >= 0 AND shipping_fee >= 0", name="ck_fulfillment_orders_amounts_nonnegative"
        ),
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', "
            "'cancelled', 'return_requested', 'returned')",
            name="ck_fulfillment_orders_status",
        ),
        Index("ix_fulfillment_orders_shop_status", "shop_id", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    shop_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="SET NULL"), index=True
    )
    shop_name: Mapped[str] = mapped_column(String(160))
    fulfillment_number: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending", server_default="pending")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    shipping_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    tracking_number: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint(
            "quantity > 0 AND unit_price > 0 AND line_total > 0",
            name="ck_order_items_amounts_positive",
        ),
        Index("ix_order_items_fulfillment", "fulfillment_order_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    fulfillment_order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fulfillment_orders.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="SET NULL")
    )
    variant_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("product_variants.id", ondelete="SET NULL")
    )
    inventory_variant: Mapped[bool] = mapped_column(default=False, server_default="false")
    product_name: Mapped[str] = mapped_column(String(180))
    variant_name: Mapped[str | None] = mapped_column(String(120))
    sku: Mapped[str] = mapped_column(String(80))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderStatusEvent(Base):
    __tablename__ = "order_status_events"
    __table_args__ = (
        Index("ix_order_status_events_fulfillment_created", "fulfillment_order_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    fulfillment_order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fulfillment_orders.id", ondelete="SET NULL"), index=True
    )
    actor_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderNotification(Base):
    __tablename__ = "order_notifications"
    __table_args__ = (
        Index("ix_order_notifications_user_created", "user_id", "created_at"),
        CheckConstraint(
            "workspace IN ('customer', 'vendor', 'admin', 'account')",
            name="ck_order_notifications_workspace",
        ),
        CheckConstraint(
            "(workspace = 'vendor' AND shop_id IS NOT NULL) OR "
            "(workspace <> 'vendor' AND shop_id IS NULL)",
            name="ck_order_notifications_shop_scope",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace: Mapped[str] = mapped_column(String(16))
    shop_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT")
    )
    order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL")
    )
    fulfillment_order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fulfillment_orders.id", ondelete="SET NULL")
    )
    conversation_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(160))
    message: Mapped[str] = mapped_column(String(500))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_transactions_amount_positive"),
        CheckConstraint(
            "transaction_type IN ('charge', 'refund')",
            name="ck_payment_transactions_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'collected', 'cancelled', 'refund_due', 'refunded')",
            name="ck_payment_transactions_status",
        ),
        Index("ix_payment_transactions_order_created", "order_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    fulfillment_order_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("fulfillment_orders.id", ondelete="CASCADE"), index=True
    )
    transaction_type: Mapped[str] = mapped_column(
        String(16), default="charge", server_default="charge"
    )
    method: Mapped[str] = mapped_column(
        String(32), default="cash_on_delivery", server_default="cash_on_delivery"
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    recorded_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
