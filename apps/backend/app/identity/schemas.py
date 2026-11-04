from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    full_name: str = Field(min_length=1, max_length=120)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().casefold()

    @field_validator("full_name")
    @classmethod
    def trim_full_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("full_name cannot be blank")
        return normalized


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().casefold()


class TokenRequest(BaseModel):
    token: str = Field(min_length=32, max_length=256)


class EmailRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().casefold()


class PasswordResetRequest(TokenRequest):
    password: str = Field(min_length=12, max_length=128)


class MessageResponse(BaseModel):
    message: str


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=32)

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("full_name cannot be blank")
        return normalized

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    phone: str | None


class UserRead(BaseModel):
    id: UUID
    email: EmailStr
    email_verified: bool
    account_status: str
    roles: list[str]
    profile: ProfileRead | None
    created_at: datetime


class AdminUserRead(BaseModel):
    id: UUID
    email: EmailStr
    account_status: str
    roles: list[str]
    created_at: datetime


class AddressCreate(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    recipient_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=1, max_length=32)
    province: str = Field(min_length=1, max_length=80)
    city: str = Field(min_length=1, max_length=80)
    area: str | None = Field(default=None, max_length=120)
    street_address: str = Field(min_length=1, max_length=240)
    postal_code: str | None = Field(default=None, max_length=20)
    is_default: bool = False

    @field_validator(
        "label",
        "recipient_name",
        "phone",
        "province",
        "city",
        "street_address",
    )
    @classmethod
    def trim_required_address_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("address fields cannot be blank")
        return normalized

    @field_validator("area", "postal_code")
    @classmethod
    def trim_optional_address_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AddressRead(AddressCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime


class VendorApplicationCreate(BaseModel):
    business_name: str = Field(min_length=2, max_length=160)
    business_type: str = Field(min_length=2, max_length=80)
    registration_number: str | None = Field(default=None, max_length=80)
    business_address: str = Field(min_length=5, max_length=320)

    @field_validator("business_name", "business_type", "business_address")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized


class VendorApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    business_name: str
    business_type: str
    registration_number: str | None
    business_address: str
    status: str
    review_notes: str | None
    submitted_at: datetime
    reviewed_at: datetime | None


class AdminVendorApplicationRead(VendorApplicationRead):
    email: EmailStr


class VendorDecision(BaseModel):
    status: Literal["approved", "rejected"]
    review_notes: str | None = Field(default=None, max_length=1000)


class AccountSuspension(BaseModel):
    suspended: bool
    reason: str = Field(min_length=5, max_length=1000)

    @field_validator("reason")
    @classmethod
    def trim_reason(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("reason must be at least 5 characters")
        return normalized


class SessionRead(BaseModel):
    id: UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    user_agent: str | None
    current: bool


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    document_type: str
    original_filename: str
    content_type: str
    file_size: int
    uploaded_at: datetime


class DocumentUrlRead(BaseModel):
    url: str
    expires_in_seconds: int


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_id: UUID | None
    action: str
    target_type: str
    target_id: str
    details: str | None
    created_at: datetime
