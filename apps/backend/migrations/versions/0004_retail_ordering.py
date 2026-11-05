"""Add retail carts, ordering, fulfillment, and COD transactions.

Revision ID: 0004_retail_ordering
Revises: 0003_catalog_discovery
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0004_retail_ordering"
down_revision: str | None = "0003_catalog_discovery"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "cart_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("variant_id", sa.Uuid(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("quantity > 0", name="ck_cart_items_quantity_positive"),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cart_items_product_id", "cart_items", ["product_id"])
    op.create_index("ix_cart_items_user_id", "cart_items", ["user_id"])
    op.create_index("ix_cart_items_variant_id", "cart_items", ["variant_id"])
    op.create_index("ix_cart_items_user_created", "cart_items", ["user_id", "created_at"])

    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("order_number", sa.String(length=40), nullable=False),
        sa.Column("invoice_number", sa.String(length=48), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("address_id", sa.Uuid(), nullable=True),
        sa.Column("shipping_address", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column(
            "payment_method",
            sa.String(length=32),
            server_default="cash_on_delivery",
            nullable=False,
        ),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("shipping_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "subtotal >= 0 AND shipping_total >= 0 AND total >= 0",
            name="ck_orders_amounts_nonnegative",
        ),
        sa.CheckConstraint("payment_method = 'cash_on_delivery'", name="ck_orders_payment_method"),
        sa.CheckConstraint(
            "status IN ('pending', 'in_progress', 'completed', 'partially_cancelled', "
            "'cancelled', 'return_requested', 'returned')",
            name="ck_orders_status",
        ),
        sa.ForeignKeyConstraint(["address_id"], ["delivery_addresses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "customer_id", "idempotency_key", name="uq_orders_customer_idempotency"
        ),
        sa.UniqueConstraint("invoice_number"),
    )
    op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
    op.create_index("ix_orders_order_number", "orders", ["order_number"], unique=True)

    op.create_table(
        "fulfillment_orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("shop_id", sa.Uuid(), nullable=True),
        sa.Column("shop_name", sa.String(length=160), nullable=False),
        sa.Column("fulfillment_number", sa.String(length=48), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("shipping_fee", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("tracking_number", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "subtotal >= 0 AND shipping_fee >= 0",
            name="ck_fulfillment_orders_amounts_nonnegative",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', "
            "'cancelled', 'return_requested', 'returned')",
            name="ck_fulfillment_orders_status",
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fulfillment_orders_order_id", "fulfillment_orders", ["order_id"])
    op.create_index("ix_fulfillment_orders_shop_id", "fulfillment_orders", ["shop_id"])
    op.create_index(
        "ix_fulfillment_orders_fulfillment_number",
        "fulfillment_orders",
        ["fulfillment_number"],
        unique=True,
    )
    op.create_index(
        "ix_fulfillment_orders_shop_status",
        "fulfillment_orders",
        ["shop_id", "status", "created_at"],
    )

    op.create_table(
        "order_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("fulfillment_order_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("variant_id", sa.Uuid(), nullable=True),
        sa.Column(
            "inventory_variant", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("product_name", sa.String(length=180), nullable=False),
        sa.Column("variant_name", sa.String(length=120), nullable=True),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("line_total", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "quantity > 0 AND unit_price > 0 AND line_total > 0",
            name="ck_order_items_amounts_positive",
        ),
        sa.ForeignKeyConstraint(
            ["fulfillment_order_id"], ["fulfillment_orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["variant_id"], ["product_variants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_fulfillment_order_id", "order_items", ["fulfillment_order_id"])
    op.create_index("ix_order_items_fulfillment", "order_items", ["fulfillment_order_id"])

    op.create_table(
        "order_status_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("fulfillment_order_id", sa.Uuid(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["fulfillment_order_id"], ["fulfillment_orders.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_status_events_order_id", "order_status_events", ["order_id"])
    op.create_index(
        "ix_order_status_events_fulfillment_order_id",
        "order_status_events",
        ["fulfillment_order_id"],
    )
    op.create_index(
        "ix_order_status_events_fulfillment_created",
        "order_status_events",
        ["fulfillment_order_id", "created_at"],
    )

    op.create_table(
        "order_notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("fulfillment_order_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["fulfillment_order_id"], ["fulfillment_orders.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_notifications_user_id", "order_notifications", ["user_id"])
    op.create_index(
        "ix_order_notifications_user_created", "order_notifications", ["user_id", "created_at"]
    )

    op.create_table(
        "payment_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("fulfillment_order_id", sa.Uuid(), nullable=False),
        sa.Column(
            "transaction_type", sa.String(length=16), server_default="charge", nullable=False
        ),
        sa.Column(
            "method", sa.String(length=32), server_default="cash_on_delivery", nullable=False
        ),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("recorded_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("amount > 0", name="ck_payment_transactions_amount_positive"),
        sa.CheckConstraint(
            "transaction_type IN ('charge', 'refund')",
            name="ck_payment_transactions_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'collected', 'cancelled', 'refund_due', 'refunded')",
            name="ck_payment_transactions_status",
        ),
        sa.ForeignKeyConstraint(
            ["fulfillment_order_id"], ["fulfillment_orders.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payment_transactions_order_id", "payment_transactions", ["order_id"])
    op.create_index(
        "ix_payment_transactions_fulfillment_order_id",
        "payment_transactions",
        ["fulfillment_order_id"],
    )
    op.create_index(
        "ix_payment_transactions_order_created",
        "payment_transactions",
        ["order_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_payment_transactions_order_created", table_name="payment_transactions")
    op.drop_index("ix_payment_transactions_fulfillment_order_id", table_name="payment_transactions")
    op.drop_index("ix_payment_transactions_order_id", table_name="payment_transactions")
    op.drop_table("payment_transactions")
    op.drop_index("ix_order_notifications_user_created", table_name="order_notifications")
    op.drop_index("ix_order_notifications_user_id", table_name="order_notifications")
    op.drop_table("order_notifications")
    op.drop_index("ix_order_status_events_fulfillment_created", table_name="order_status_events")
    op.drop_index("ix_order_status_events_fulfillment_order_id", table_name="order_status_events")
    op.drop_index("ix_order_status_events_order_id", table_name="order_status_events")
    op.drop_table("order_status_events")
    op.drop_index("ix_order_items_fulfillment", table_name="order_items")
    op.drop_index("ix_order_items_fulfillment_order_id", table_name="order_items")
    op.drop_table("order_items")
    op.drop_index("ix_fulfillment_orders_shop_status", table_name="fulfillment_orders")
    op.drop_index("ix_fulfillment_orders_fulfillment_number", table_name="fulfillment_orders")
    op.drop_index("ix_fulfillment_orders_shop_id", table_name="fulfillment_orders")
    op.drop_index("ix_fulfillment_orders_order_id", table_name="fulfillment_orders")
    op.drop_table("fulfillment_orders")
    op.drop_index("ix_orders_order_number", table_name="orders")
    op.drop_index("ix_orders_customer_id", table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_cart_items_user_created", table_name="cart_items")
    op.drop_index("ix_cart_items_variant_id", table_name="cart_items")
    op.drop_index("ix_cart_items_user_id", table_name="cart_items")
    op.drop_index("ix_cart_items_product_id", table_name="cart_items")
    op.drop_table("cart_items")
