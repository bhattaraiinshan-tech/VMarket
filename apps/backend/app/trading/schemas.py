from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WholesalePriceTierCreate(BaseModel):
    minimum_quantity: int = Field(ge=1, le=2_147_483_647)
    unit_price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)


class WholesaleListingCreate(BaseModel):
    product_id: UUID
    minimum_order_quantity: int = Field(ge=1, le=2_147_483_647)
    available_quantity: int = Field(ge=0, le=2_147_483_647)
    unit_label: str = Field(default="piece", min_length=1, max_length=40)
    price_tiers: list[WholesalePriceTierCreate] = Field(min_length=1, max_length=20)

    @field_validator("unit_label")
    @classmethod
    def trim_unit_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("unit_label cannot be blank")
        return normalized


class WholesalePriceTierRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    minimum_quantity: int
    unit_price: Decimal


class WholesaleListingRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_name: str
    shop_slug: str
    city: str
    province: str
    product_id: UUID
    product_name: str
    product_description: str
    product_sku: str
    minimum_order_quantity: int
    available_quantity: int
    unit_label: str
    is_active: bool
    price_tiers: list[WholesalePriceTierRead]
    created_at: datetime


class TradeRFQCreate(BaseModel):
    listing_id: UUID
    quantity: int = Field(ge=1, le=2_147_483_647)
    requested_delivery_date: date | None = None
    delivery_terms: str = Field(min_length=1, max_length=1000)
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("delivery_terms", "message")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized


class TradeQuoteCreate(BaseModel):
    quantity: int = Field(ge=1, le=2_147_483_647)
    unit_price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    delivery_terms: str = Field(min_length=1, max_length=1000)
    valid_until: datetime | None = None
    note: str = Field(min_length=1, max_length=2000)

    @field_validator("delivery_terms", "note")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @model_validator(mode="after")
    def validate_order_total(self) -> "TradeQuoteCreate":
        if self.unit_price * self.quantity > Decimal("99999999999999.99"):
            raise ValueError("quoted total exceeds the supported order amount")
        return self


class TradeNegotiationEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    quote_id: UUID | None
    actor_shop_id: UUID
    note: str
    created_at: datetime


class TradeQuoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    revision: int
    quantity: int
    unit_price: Decimal
    delivery_terms: str
    valid_until: datetime | None
    status: str
    created_at: datetime


class TradeRFQRead(BaseModel):
    id: UUID
    buyer_shop_id: UUID
    buyer_shop_name: str
    seller_shop_id: UUID
    seller_shop_name: str
    listing_id: UUID
    product_name: str
    quantity: int
    requested_delivery_date: date | None
    delivery_terms: str
    message: str
    status: str
    quotes: list[TradeQuoteRead]
    negotiation_history: list[TradeNegotiationEventRead]
    created_at: datetime
    updated_at: datetime


class TradeOrderEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_shop_id: UUID | None
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime


class TradeDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    purchase_order_id: UUID | None
    transfer_id: UUID | None
    uploader_shop_id: UUID
    original_filename: str
    content_type: str
    file_size: int
    uploaded_at: datetime


class TradePurchaseOrderRead(BaseModel):
    id: UUID
    rfq_id: UUID
    quote_id: UUID
    buyer_shop_id: UUID
    buyer_shop_name: str
    seller_shop_id: UUID
    seller_shop_name: str
    listing_id: UUID
    product_name: str
    order_number: str
    quantity: int
    unit_price: Decimal
    total: Decimal
    delivery_terms: str
    status: str
    business_review_submitted: bool
    events: list[TradeOrderEventRead]
    documents: list[TradeDocumentRead]
    created_at: datetime
    updated_at: datetime


class TradeStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("note")
    @classmethod
    def trim_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class TradeNegotiationNote(BaseModel):
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("note")
    @classmethod
    def trim_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class TradeStockTransferCreate(BaseModel):
    destination_shop_id: UUID
    source_product_id: UUID
    destination_product_id: UUID
    quantity: int = Field(ge=1, le=2_147_483_647)
    delivery_terms: str = Field(min_length=1, max_length=1000)

    @field_validator("delivery_terms")
    @classmethod
    def trim_delivery_terms(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("delivery_terms cannot be blank")
        return normalized


class TradeTransferEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_shop_id: UUID | None
    from_status: str | None
    to_status: str
    note: str | None
    created_at: datetime


class TradeStockTransferRead(BaseModel):
    id: UUID
    source_shop_id: UUID
    source_shop_name: str
    destination_shop_id: UUID
    destination_shop_name: str
    source_product_id: UUID
    source_product_name: str
    destination_product_id: UUID
    destination_product_name: str
    quantity: int
    delivery_terms: str
    status: str
    events: list[TradeTransferEventRead]
    documents: list[TradeDocumentRead]
    created_at: datetime
    updated_at: datetime


class TradeBusinessReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    body: str = Field(min_length=1, max_length=3000)

    @field_validator("body")
    @classmethod
    def trim_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("body cannot be blank")
        return normalized


class TradeBusinessReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    reviewer_shop_id: UUID
    supplier_shop_id: UUID
    rating: int
    body: str
    created_at: datetime


class TradeSupplierRead(BaseModel):
    shop_id: UUID
    shop_name: str
    shop_slug: str
    city: str
    province: str
    active_listing_count: int
    completed_trade_count: int
    average_rating: Decimal | None
    reviews: list[TradeBusinessReviewRead]
