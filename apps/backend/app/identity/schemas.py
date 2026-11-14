from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictBool, field_validator


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


class AccountDetailsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    preferred_categories: list[str] | None = Field(default=None, max_length=50)
    communication_email: StrictBool | None = None
    communication_sms: StrictBool | None = None
    business_category: str | None = Field(default=None, max_length=120)
    registration_number: str | None = Field(default=None, max_length=120)
    payout_preference: Literal["manual", "bank_transfer"] | None = None
    business_description: str | None = Field(default=None, max_length=1000)

    @field_validator("first_name", "last_name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("phone", "business_category", "registration_number", "business_description")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value is not None else None

    @field_validator("preferred_categories")
    @classmethod
    def validate_categories(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized = [category.strip() for category in value]
        if any(not category or len(category) > 120 for category in normalized):
            raise ValueError("Categories must be non-empty and at most 120 characters.")
        return normalized


class AccountDetailsRead(BaseModel):
    workspace: Literal["customer", "vendor"]
    first_name: str
    last_name: str
    email: str
    email_verified: bool
    phone: str | None
    avatar_url: str | None
    preferred_categories: list[str]
    communication_email: bool
    communication_sms: bool
    business_name: str | None
    business_category: str | None
    registration_number: str | None
    payout_preference: Literal["manual", "bank_transfer"] | None
    business_description: str | None


class VendorProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    business_name: str


class UserRead(BaseModel):
    owned_shop_ids: list[UUID] = Field(default_factory=list)
    id: UUID
    email: EmailStr
    email_verified: bool
    account_status: str
    roles: list[str]
    profile: ProfileRead | None
    vendor_profile: VendorProfileRead | None
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


class ExportAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    email_verified: bool
    account_status: str
    created_at: datetime


class ExportShopRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    address: str | None
    city: str
    province: str
    is_active: bool


class ExportCommonSettings(BaseModel):
    first_name: str
    last_name: str
    phone: str | None
    avatar_url: str | None
    communication_email: bool
    communication_sms: bool


class CustomerSettingsExport(ExportCommonSettings):
    preferred_categories: list[str]


class VendorSettingsExport(ExportCommonSettings):
    business_name: str | None
    business_category: str | None
    registration_number: str | None
    payout_preference: Literal["manual", "bank_transfer"] | None
    business_description: str | None


class CustomerExportRead(BaseModel):
    workspace: Literal["customer"] = "customer"
    shop_id: None = None
    account: ExportAccountRead
    profile: ProfileRead
    account_settings: CustomerSettingsExport
    addresses: list[AddressRead]
    vendor_applications: list[VendorApplicationRead]


class VendorExportRead(BaseModel):
    workspace: Literal["vendor"] = "vendor"
    shop_id: UUID
    account: ExportAccountRead
    vendor_profile: VendorProfileRead
    account_settings: VendorSettingsExport
    shop: ExportShopRead


class AdminExportRead(BaseModel):
    workspace: Literal["admin"] = "admin"
    shop_id: None = None
    account: ExportAccountRead
    owner: dict[str, UUID]


WorkspaceExportRead = CustomerExportRead | VendorExportRead | AdminExportRead
