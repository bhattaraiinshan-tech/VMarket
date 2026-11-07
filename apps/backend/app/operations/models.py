from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
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


class PlatformSettings(Base):
    __tablename__ = "platform_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_platform_settings_singleton"),
        CheckConstraint(
            "commission_rate_bps BETWEEN 300 AND 500",
            name="ck_platform_settings_commission_range",
        ),
        CheckConstraint(
            "return_window_days BETWEEN 1 AND 30",
            name="ck_platform_settings_return_window",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    commission_rate_bps: Mapped[int] = mapped_column(Integer, default=300, server_default="300")
    return_window_days: Mapped[int] = mapped_column(Integer, default=7, server_default="7")
    updated_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Promotion(Base):
    __tablename__ = "promotions"
    __table_args__ = (
        CheckConstraint(
            "discount_type IN ('percent', 'fixed')",
            name="ck_promotions_discount_type",
        ),
        CheckConstraint(
            "discount_value > 0",
            name="ck_promotions_discount_value_positive",
        ),
        CheckConstraint(
            "discount_type <> 'percent' OR discount_value <= 100",
            name="ck_promotions_percent_max",
        ),
        CheckConstraint(
            "sponsor_type IN ('platform', 'vendor')",
            name="ck_promotions_sponsor_type",
        ),
        CheckConstraint(
            "(sponsor_type = 'platform' AND shop_id IS NULL) OR "
            "(sponsor_type = 'vendor' AND shop_id IS NOT NULL)",
            name="ck_promotions_sponsor_shop",
        ),
        CheckConstraint(
            "starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at",
            name="ck_promotions_dates",
        ),
        CheckConstraint(
            "max_redemptions IS NULL OR max_redemptions > 0",
            name="ck_promotions_redemption_limit",
        ),
        Index("ix_promotions_active_dates", "is_active", "starts_at", "ends_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    discount_type: Mapped[str] = mapped_column(String(12))
    discount_value: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    sponsor_type: Mapped[str] = mapped_column(String(12))
    shop_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="RESTRICT"), index=True
    )
    created_by_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_redemptions: Mapped[int | None] = mapped_column(Integer)
    redemption_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class FraudReport(Base):
    __tablename__ = "fraud_reports"
    __table_args__ = (
        CheckConstraint(
            "target_type IN ('product', 'shop', 'order', 'review', 'vendor')",
            name="ck_fraud_reports_target_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'investigating', 'resolved', 'dismissed')",
            name="ck_fraud_reports_status",
        ),
        CheckConstraint(
            "length(reason) > 0",
            name="ck_fraud_reports_reason",
        ),
        Index("ix_fraud_reports_status_created", "status", "created_at"),
        Index("ix_fraud_reports_target", "target_type", "target_id"),
        UniqueConstraint(
            "reporter_id",
            "target_type",
            "target_id",
            name="uq_fraud_reports_reporter_target",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    reporter_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True))
    reason: Mapped[str] = mapped_column(String(120))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    investigation_notes: Mapped[str | None] = mapped_column(Text)
    investigated_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    investigated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
