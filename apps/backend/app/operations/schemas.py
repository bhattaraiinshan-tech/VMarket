from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class PlatformSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    commission_rate_bps: int
    return_window_days: int
    updated_at: datetime


class PlatformSettingsUpdate(BaseModel):
    commission_rate_bps: int | None = Field(default=None, ge=300, le=500)
    return_window_days: int | None = Field(default=None, ge=1, le=30)

    @model_validator(mode="after")
    def require_update(self) -> "PlatformSettingsUpdate":
        if not self.model_fields_set:
            raise ValueError("At least one setting must be provided.")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Settings cannot be null.")
        return self


class PromotionCreate(BaseModel):
    code: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    title: str = Field(min_length=2, max_length=160)
    discount_type: Literal["percent", "fixed"]
    discount_value: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = Field(default=None, ge=1, le=1_000_000)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("title")
    @classmethod
    def trim_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("title cannot be blank")
        return normalized

    @model_validator(mode="after")
    def validate_promotion(self) -> "PromotionCreate":
        if self.discount_type == "percent" and self.discount_value > 100:
            raise ValueError("Percentage discounts cannot exceed 100.")
        if self.starts_at and self.ends_at and self.starts_at >= self.ends_at:
            raise ValueError("ends_at must be later than starts_at.")
        return self


class PromotionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    title: str
    discount_type: str
    discount_value: Decimal
    sponsor_type: str
    shop_id: UUID | None
    is_active: bool
    starts_at: datetime | None
    ends_at: datetime | None
    max_redemptions: int | None
    redemption_count: int
    created_at: datetime


class PromotionStatusUpdate(BaseModel):
    is_active: bool


class FraudReportCreate(BaseModel):
    target_type: Literal["product", "shop", "order", "review", "vendor"]
    target_id: UUID
    reason: str = Field(min_length=3, max_length=120)
    details: str | None = Field(default=None, max_length=2000)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason cannot be blank")
        return normalized

    @field_validator("details")
    @classmethod
    def trim_details(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class FraudReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reporter_id: UUID
    target_type: str
    target_id: UUID
    reason: str
    details: str | None
    status: str
    investigation_notes: str | None
    investigated_by_id: UUID | None
    investigated_at: datetime | None
    created_at: datetime
    reporter_email: str | None = None


class FraudReportUpdate(BaseModel):
    status: Literal["investigating", "resolved", "dismissed"]
    investigation_notes: str = Field(min_length=3, max_length=2000)

    @field_validator("investigation_notes")
    @classmethod
    def trim_notes(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("investigation notes cannot be blank")
        return normalized


class OperationsDashboardRead(BaseModel):
    users_total: int
    active_vendors: int
    pending_vendor_applications: int
    pending_products: int
    orders_total: int
    open_orders: int
    open_disputes: int
    pending_fraud_reports: int
    pending_payments: int
    collected_npr: Decimal
    refunds_due_npr: Decimal
    commission_accrued_npr: Decimal


class AdminOrderRead(BaseModel):
    id: UUID
    customer_id: UUID
    customer_email: str
    order_number: str
    status: str
    payment_method: str
    subtotal: Decimal
    shipping_total: Decimal
    discount_total: Decimal
    total: Decimal
    promotion_code: str | None
    created_at: datetime
    updated_at: datetime


class AdminPaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID
    order_number: str
    fulfillment_order_id: UUID
    shop_name: str
    customer_email: str
    transaction_type: str
    method: str
    status: str
    amount: Decimal
    created_at: datetime
    updated_at: datetime


class OperationsAuditRead(BaseModel):
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    details: str | None
    created_at: datetime
