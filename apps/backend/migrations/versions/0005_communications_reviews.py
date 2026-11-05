"""Add customer/vendor communications, reviews, and support tickets.

Revision ID: 0005_communications_reviews
Revises: 0004_retail_ordering
Create Date: 2026-11-05
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0005_communications_reviews"
down_revision: str | None = "0004_retail_ordering"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("shop_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("customer_id", "shop_id", name="uq_conversations_customer_shop"),
    )
    op.create_index("ix_conversations_customer_id", "conversations", ["customer_id"])
    op.create_index("ix_conversations_shop_id", "conversations", ["shop_id"])
    op.create_index(
        "ix_conversations_customer_updated", "conversations", ["customer_id", "updated_at"]
    )
    op.create_index("ix_conversations_shop_updated", "conversations", ["shop_id", "updated_at"])

    op.create_table(
        "conversation_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("sender_id", sa.Uuid(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("length(content) > 0", name="ck_conversation_messages_content_nonempty"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_conversation_messages_conversation_id", "conversation_messages", ["conversation_id"]
    )
    op.create_index("ix_conversation_messages_sender_id", "conversation_messages", ["sender_id"])
    op.create_index(
        "ix_conversation_messages_conversation_created",
        "conversation_messages",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "ix_conversation_messages_conversation_unread",
        "conversation_messages",
        ["conversation_id", "read_at"],
    )

    op.create_table(
        "product_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("order_item_id", sa.Uuid(), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "moderation_status",
            sa.String(length=16),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("vendor_response", sa.Text(), nullable=True),
        sa.Column("vendor_responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("moderated_by_id", sa.Uuid(), nullable=True),
        sa.Column("moderated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_product_reviews_rating"),
        sa.CheckConstraint(
            "moderation_status IN ('pending', 'visible', 'hidden')",
            name="ck_product_reviews_moderation_status",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["order_item_id"], ["order_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["moderated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("order_item_id", name="uq_product_reviews_order_item"),
    )
    op.create_index("ix_product_reviews_product_id", "product_reviews", ["product_id"])
    op.create_index("ix_product_reviews_order_item_id", "product_reviews", ["order_item_id"])
    op.create_index("ix_product_reviews_customer_id", "product_reviews", ["customer_id"])
    op.create_index(
        "ix_product_reviews_moderation_status", "product_reviews", ["moderation_status"]
    )
    op.create_index(
        "ix_product_reviews_product_status_created",
        "product_reviews",
        ["product_id", "moderation_status", "created_at"],
    )

    op.create_table(
        "review_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("reporter_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(length=80), nullable=False),
        sa.Column("details", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("resolved_by_id", sa.Uuid(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'resolved', 'rejected')", name="ck_review_reports_status"
        ),
        sa.ForeignKeyConstraint(["review_id"], ["product_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resolved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "reporter_id", name="uq_review_reports_review_reporter"),
    )
    op.create_index("ix_review_reports_review_id", "review_reports", ["review_id"])
    op.create_index("ix_review_reports_reporter_id", "review_reports", ["reporter_id"])
    op.create_index("ix_review_reports_status_created", "review_reports", ["status", "created_at"])

    op.create_table(
        "support_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), server_default="support", nullable=False),
        sa.Column("subject", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="open", nullable=False),
        sa.Column("admin_response", sa.Text(), nullable=True),
        sa.Column("assigned_admin_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("kind IN ('support', 'dispute')", name="ck_support_tickets_kind"),
        sa.CheckConstraint(
            "status IN ('open', 'in_progress', 'resolved', 'closed')",
            name="ck_support_tickets_status",
        ),
        sa.CheckConstraint(
            "length(subject) > 0 AND length(body) > 0", name="ck_support_tickets_content"
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_admin_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_support_tickets_created_by_id", "support_tickets", ["created_by_id"])
    op.create_index("ix_support_tickets_order_id", "support_tickets", ["order_id"])
    op.create_index(
        "ix_support_tickets_status_updated", "support_tickets", ["status", "updated_at"]
    )
    op.create_index(
        "ix_support_tickets_user_created", "support_tickets", ["created_by_id", "created_at"]
    )

    op.add_column("order_notifications", sa.Column("conversation_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_order_notifications_conversation_id_conversations",
        "order_notifications",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_order_notifications_conversation_id_conversations",
        "order_notifications",
        type_="foreignkey",
    )
    op.drop_column("order_notifications", "conversation_id")
    op.drop_index("ix_support_tickets_user_created", table_name="support_tickets")
    op.drop_index("ix_support_tickets_status_updated", table_name="support_tickets")
    op.drop_index("ix_support_tickets_order_id", table_name="support_tickets")
    op.drop_index("ix_support_tickets_created_by_id", table_name="support_tickets")
    op.drop_table("support_tickets")
    op.drop_index("ix_review_reports_status_created", table_name="review_reports")
    op.drop_index("ix_review_reports_reporter_id", table_name="review_reports")
    op.drop_index("ix_review_reports_review_id", table_name="review_reports")
    op.drop_table("review_reports")
    op.drop_index("ix_product_reviews_product_status_created", table_name="product_reviews")
    op.drop_index("ix_product_reviews_moderation_status", table_name="product_reviews")
    op.drop_index("ix_product_reviews_customer_id", table_name="product_reviews")
    op.drop_index("ix_product_reviews_order_item_id", table_name="product_reviews")
    op.drop_index("ix_product_reviews_product_id", table_name="product_reviews")
    op.drop_table("product_reviews")
    op.drop_index(
        "ix_conversation_messages_conversation_unread", table_name="conversation_messages"
    )
    op.drop_index(
        "ix_conversation_messages_conversation_created", table_name="conversation_messages"
    )
    op.drop_index("ix_conversation_messages_sender_id", table_name="conversation_messages")
    op.drop_index("ix_conversation_messages_conversation_id", table_name="conversation_messages")
    op.drop_table("conversation_messages")
    op.drop_index("ix_conversations_shop_updated", table_name="conversations")
    op.drop_index("ix_conversations_customer_updated", table_name="conversations")
    op.drop_index("ix_conversations_shop_id", table_name="conversations")
    op.drop_index("ix_conversations_customer_id", table_name="conversations")
    op.drop_table("conversations")
