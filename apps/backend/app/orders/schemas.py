from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class CartItemCreate(BaseModel):
    product_id: UUID
    variant_id: UUID | None = None
    quantity: int = Field(ge=1, le=50)


class CartItemQuantity(BaseModel):
    quantity: int = Field(ge=1, le=50)


class CartItemRead(BaseModel):
    id: UUID
    product_id: UUID
    variant_id: UUID | None
    product_name: str
    product_slug: str
    variant_name: str | None
    sku: str
    image_url: str | None
    image_alt: str
    shop_id: UUID
    shop_name: str
    unit_price: Decimal
    quantity: int
    available_stock: int
    line_total: Decimal


class CartRead(BaseModel):
    items: list[CartItemRead]
    item_count: int
    subtotal: Decimal


class CheckoutCreate(BaseModel):
    address_id: UUID
    payment_method: Literal["cash_on_delivery"] = "cash_on_delivery"
    idempotency_key: str = Field(min_length=16, max_length=128)
    promotion_code: str | None = Field(default=None, min_length=3, max_length=40)

    @field_validator("idempotency_key")
    @classmethod
    def trim_idempotency_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("idempotency_key cannot be blank")
        return normalized

    @field_validator("promotion_code")
    @classmethod
    def normalize_promotion_code(cls, value: str | None) -> str | None:
        normalized = value.strip().upper() if value else None
        return normalized or None


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    product_id: UUID | None
    variant_id: UUID | None
    product_name: str
    variant_name: str | None
    sku: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    image_url: str | None = None
    image_alt: str | None = None


class OrderEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime
    location: str | None = None


class DeliveryFeedbackCreate(BaseModel):
    rating: int = Field(strict=True, ge=1, le=5)


class DeliveryFeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rating: int
    created_at: datetime
    updated_at: datetime


class PaymentTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    transaction_type: str
    method: str
    status: str
    amount: Decimal
    created_at: datetime
    updated_at: datetime


class FulfillmentOrderRead(BaseModel):
    id: UUID
    order_id: UUID
    fulfillment_number: str
    shop_id: UUID | None
    shop_name: str
    status: str
    subtotal: Decimal
    shipping_fee: Decimal
    discount_total: Decimal
    commission_rate_bps: int
    commission_amount: Decimal
    tracking_number: str | None
    courier_name: str | None = None
    support_phone: str | None = None
    support_email: str | None = None
    delivery_feedback: DeliveryFeedbackRead | None = None
    return_deadline: datetime | None = None
    can_request_return: bool = False
    shipping_address: Mapping[str, str | None]
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemRead]
    events: list[OrderEventRead]
    transactions: list[PaymentTransactionRead]


class OrderRead(BaseModel):
    id: UUID
    order_number: str
    invoice_number: str
    status: str
    payment_method: str
    shipping_address: Mapping[str, str | None]
    subtotal: Decimal
    shipping_total: Decimal
    discount_total: Decimal
    promotion_code: str | None
    total: Decimal
    created_at: datetime
    updated_at: datetime
    fulfillments: list[FulfillmentOrderRead]


class VendorFulfillmentPage(BaseModel):
    items: list[FulfillmentOrderRead]
    total: int


class FulfillmentStatusUpdate(BaseModel):
    status: Literal[
        "confirmed",
        "processing",
        "shipped",
        "picked_up",
        "in_transit",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
        "return_rejected",
    ]
    tracking_number: str | None = Field(default=None, max_length=120)
    cash_collected: bool = False
    note: str | None = Field(default=None, max_length=500)
    courier_name: str | None = Field(default=None, max_length=120)
    location: str | None = Field(default=None, max_length=180)
    support_phone: str | None = Field(
        default=None, max_length=32, pattern=r"^\+?[0-9][0-9 ()-]{5,30}$"
    )
    support_email: EmailStr | None = Field(default=None, max_length=254)

    @field_validator(
        "tracking_number",
        "note",
        "courier_name",
        "location",
        "support_phone",
        "support_email",
        mode="before",
    )
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Enter text or null.")
        normalized = value.strip()
        return normalized or None


class NotificationBatchUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ids: list[UUID] = Field(min_length=1, max_length=100)
    action: Literal["read", "unread", "delete"]

    @field_validator("ids")
    @classmethod
    def unique_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("Notification IDs must be unique.")
        return value


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace: str
    shop_id: UUID | None
    order_id: UUID | None
    fulfillment_order_id: UUID | None
    conversation_id: UUID | None
    title: str
    message: str
    read_at: datetime | None
    created_at: datetime


class InvoiceRead(BaseModel):
    invoice_number: str
    order_number: str
    issued_at: datetime
    payment_method: str
    status: str
    shipping_address: Mapping[str, str | None]
    subtotal: Decimal
    shipping_total: Decimal
    discount_total: Decimal
    total: Decimal
    fulfillments: list[FulfillmentOrderRead]

    model_config = ConfigDict(from_attributes=True)
