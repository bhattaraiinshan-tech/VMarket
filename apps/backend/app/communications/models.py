from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("customer_id", "shop_id", name="uq_conversations_customer_shop"),
        Index("ix_conversations_customer_updated", "customer_id", "updated_at"),
        Index("ix_conversations_shop_updated", "shop_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    customer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="SET NULL")
    )
    order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ConversationMessage(Base):
    __tablename__ = "conversation_messages"
    __table_args__ = (
        CheckConstraint("length(content) > 0", name="ck_conversation_messages_content_nonempty"),
        Index("ix_conversation_messages_conversation_created", "conversation_id", "created_at"),
        Index("ix_conversation_messages_conversation_unread", "conversation_id", "read_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    content: Mapped[str] = mapped_column(Text)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductReview(Base):
    __tablename__ = "product_reviews"
    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_product_reviews_rating"),
        CheckConstraint(
            "moderation_status IN ('pending', 'visible', 'hidden')",
            name="ck_product_reviews_moderation_status",
        ),
        UniqueConstraint("order_item_id", name="uq_product_reviews_order_item"),
        Index(
            "ix_product_reviews_product_status_created",
            "product_id",
            "moderation_status",
            "created_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    order_item_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(120))
    body: Mapped[str] = mapped_column(Text)
    moderation_status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending", index=True
    )
    vendor_response: Mapped[str | None] = mapped_column(Text)
    vendor_responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    moderated_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReviewReport(Base):
    __tablename__ = "review_reports"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'resolved', 'rejected')", name="ck_review_reports_status"
        ),
        UniqueConstraint("review_id", "reporter_id", name="uq_review_reports_review_reporter"),
        Index("ix_review_reports_status_created", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    review_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("product_reviews.id", ondelete="CASCADE"), index=True
    )
    reporter_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    reason: Mapped[str] = mapped_column(String(80))
    details: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    resolved_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint("kind IN ('support', 'dispute')", name="ck_support_tickets_kind"),
        CheckConstraint(
            "status IN ('open', 'in_progress', 'resolved', 'closed')",
            name="ck_support_tickets_status",
        ),
        CheckConstraint(
            "length(subject) > 0 AND length(body) > 0",
            name="ck_support_tickets_content",
        ),
        Index("ix_support_tickets_status_updated", "status", "updated_at"),
        Index("ix_support_tickets_user_created", "created_by_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    created_by_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    order_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), default="support", server_default="support")
    subject: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open")
    admin_response: Mapped[str | None] = mapped_column(Text)
    assigned_admin_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
