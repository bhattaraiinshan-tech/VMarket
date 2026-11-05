from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    variant_name: str | None
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

    @field_validator("idempotency_key")
    @classmethod
    def trim_idempotency_key(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("idempotency_key cannot be blank")
        return normalized


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


class OrderEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime


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
    fulfillment_number: str
    shop_id: UUID | None
    shop_name: str
    status: str
    subtotal: Decimal
    shipping_fee: Decimal
    tracking_number: str | None
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
    shipping_address: dict[str, str | None]
    subtotal: Decimal
    shipping_total: Decimal
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
        "delivered",
        "cancelled",
        "returned",
        "return_rejected",
    ]
    tracking_number: str | None = Field(default=None, max_length=120)
    cash_collected: bool = False
    note: str | None = Field(default=None, max_length=500)

    @field_validator("tracking_number", "note")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    order_id: UUID | None
    fulfillment_order_id: UUID | None
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
    shipping_address: dict[str, str | None]
    subtotal: Decimal
    shipping_total: Decimal
    total: Decimal
    fulfillments: list[FulfillmentOrderRead]

    model_config = ConfigDict(from_attributes=True)
