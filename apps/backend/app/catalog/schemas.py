from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CategoryAttributeCreate(BaseModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=120)
    value_type: Literal["text", "number", "boolean"] = "text"
    required: bool = False
    applies_to_variant: bool = False

    @field_validator("label")
    @classmethod
    def trim_label(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("label cannot be blank")
        return normalized


class CategoryAttributeRead(CategoryAttributeCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    category_id: UUID


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: UUID | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized


class CategoryRead(BaseModel):
    id: UUID
    parent_id: UUID | None
    name: str
    slug: str
    attributes: list[CategoryAttributeRead] = Field(default_factory=list)


class BrandCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized


class BrandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str


class ShopCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    address: str | None = Field(default=None, max_length=320)
    city: str = Field(min_length=1, max_length=80)
    province: str = Field(min_length=1, max_length=80)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90, max_digits=9, decimal_places=6)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180, max_digits=9, decimal_places=6)

    @field_validator("name", "city", "province")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("description", "address")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_coordinates(self) -> "ShopCreate":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("latitude and longitude must be provided together")
        return self


class ShopUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=2000)
    address: str | None = Field(default=None, max_length=320)
    city: str | None = Field(default=None, min_length=1, max_length=80)
    province: str | None = Field(default=None, min_length=1, max_length=80)
    latitude: Decimal | None = Field(default=None, ge=-90, le=90, max_digits=9, decimal_places=6)
    longitude: Decimal | None = Field(default=None, ge=-180, le=180, max_digits=9, decimal_places=6)

    @field_validator("name", "city", "province")
    @classmethod
    def trim_optional_required_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("description", "address")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_coordinates(self) -> "ShopUpdate":
        if ("latitude" in self.model_fields_set) != ("longitude" in self.model_fields_set):
            raise ValueError("latitude and longitude must be updated together")
        return self


class ShopRead(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    address: str | None
    city: str
    province: str
    latitude: Decimal | None
    longitude: Decimal | None
    logo_url: str | None = None
    distance_km: float | None = None
    created_at: datetime


class ProductCreate(BaseModel):
    category_id: UUID
    brand_id: UUID | None = None
    name: str = Field(min_length=2, max_length=180)
    description: str = Field(min_length=1, max_length=10000)
    sku: str = Field(min_length=1, max_length=80)
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    stock: int = Field(default=0, ge=0, le=2_147_483_647)
    attributes: dict[str, str] = Field(default_factory=dict)

    @field_validator("name", "description", "sku")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str) -> str:
        return value.strip().upper()


class ProductUpdate(BaseModel):
    category_id: UUID | None = None
    brand_id: UUID | None = None
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = Field(default=None, min_length=1, max_length=10000)
    sku: str | None = Field(default=None, min_length=1, max_length=80)
    price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    stock: int | None = Field(default=None, ge=0, le=2_147_483_647)
    attributes: dict[str, str] | None = None

    @field_validator("name", "description")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("sku")
    @classmethod
    def normalize_optional_sku(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized.upper()


class ProductVariantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sku: str = Field(min_length=1, max_length=80)
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    stock: int = Field(default=0, ge=0, le=2_147_483_647)
    attributes: dict[str, str] = Field(default_factory=dict)

    @field_validator("name", "sku")
    @classmethod
    def trim_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("sku")
    @classmethod
    def normalize_sku(cls, value: str) -> str:
        return value.strip().upper()


class ProductVariantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sku: str | None = Field(default=None, min_length=1, max_length=80)
    price: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)
    stock: int | None = Field(default=None, ge=0, le=2_147_483_647)
    attributes: dict[str, str] | None = None

    @field_validator("name")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized

    @field_validator("sku")
    @classmethod
    def normalize_optional_sku(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized.upper()


class ProductVariantRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    sku: str
    price: Decimal
    stock: int
    attributes: dict[str, str]


class ProductImageRead(BaseModel):
    id: UUID
    url: str
    alt_text: str
    sort_order: int


class ProductRead(BaseModel):
    id: UUID
    shop_id: UUID
    shop_name: str
    shop_slug: str
    category_id: UUID
    category_name: str
    brand_id: UUID | None
    brand_name: str | None
    name: str
    slug: str
    description: str
    sku: str
    price: Decimal
    stock: int
    available: bool
    attributes: dict[str, str]
    status: str
    moderation_notes: str | None
    images: list[ProductImageRead]
    variants: list[ProductVariantRead]
    created_at: datetime


class ProductPage(BaseModel):
    items: list[ProductRead]
    total: int
    page: int
    page_size: int


class ProductModerationDecision(BaseModel):
    status: Literal["approved", "rejected"]
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("notes")
    @classmethod
    def trim_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
