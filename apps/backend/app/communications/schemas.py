from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _trim_required(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("This field cannot be blank")
    return normalized


class ConversationCreate(BaseModel):
    shop_id: UUID
    product_id: UUID | None = None
    order_id: UUID | None = None


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)

    @field_validator("content")
    @classmethod
    def trim_content(cls, value: str) -> str:
        return _trim_required(value)


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    sender_id: UUID
    content: str
    read_at: datetime | None
    created_at: datetime


class ConversationRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_owner_id: UUID
    shop_name: str
    customer_id: UUID
    customer_name: str
    current_user_id: UUID
    product_id: UUID | None
    product_name: str | None
    order_id: UUID | None
    unread_count: int
    last_message: MessageRead | None
    created_at: datetime
    updated_at: datetime


class ReviewCreate(BaseModel):
    order_item_id: UUID
    rating: int = Field(ge=1, le=5)
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=3000)

    @field_validator("title", "body")
    @classmethod
    def trim_review_text(cls, value: str) -> str:
        return _trim_required(value)


class ReviewRead(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    order_item_id: UUID
    customer_name: str
    rating: int
    title: str
    body: str
    moderation_status: str
    vendor_response: str | None
    created_at: datetime
    vendor_responded_at: datetime | None


class ReviewReportCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=80)
    details: str | None = Field(default=None, max_length=1000)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        return _trim_required(value)

    @field_validator("details")
    @classmethod
    def trim_details(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class ReviewReportRead(BaseModel):
    id: UUID
    review_id: UUID
    reporter_id: UUID
    reason: str
    details: str | None
    status: str
    resolved_by_id: UUID | None
    resolved_at: datetime | None
    created_at: datetime
    review: ReviewRead


class ReviewModerationUpdate(BaseModel):
    status: Literal["visible", "hidden"] | None = None
    report_status: Literal["resolved", "rejected"] | None = None


class VendorReviewResponse(BaseModel):
    response: str = Field(min_length=1, max_length=3000)

    @field_validator("response")
    @classmethod
    def trim_response(cls, value: str) -> str:
        return _trim_required(value)


class SupportTicketCreate(BaseModel):
    kind: Literal["support", "dispute"] = "support"
    order_id: UUID | None = None
    subject: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=5000)

    @field_validator("subject", "body")
    @classmethod
    def trim_ticket_text(cls, value: str) -> str:
        return _trim_required(value)


class SupportTicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_by_id: UUID
    order_id: UUID | None
    kind: str
    subject: str
    body: str
    status: str
    admin_response: str | None
    assigned_admin_id: UUID | None
    created_at: datetime
    updated_at: datetime


class SupportTicketUpdate(BaseModel):
    status: Literal["open", "in_progress", "resolved", "closed"]
    admin_response: str | None = Field(default=None, max_length=5000)

    @field_validator("admin_response")
    @classmethod
    def trim_admin_response(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None
