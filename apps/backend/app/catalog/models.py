from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
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


class CatalogCategory(Base):
    __tablename__ = "catalog_categories"
    __table_args__ = (
        CheckConstraint("name <> '' AND slug <> ''", name="ck_catalog_categories_name_slug"),
        Index("ix_catalog_categories_parent_active", "parent_id", "is_active"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CategoryAttribute(Base):
    __tablename__ = "category_attributes"
    __table_args__ = (
        CheckConstraint(
            "value_type IN ('text', 'number', 'boolean')",
            name="ck_category_attributes_value_type",
        ),
        UniqueConstraint("category_id", "key", name="uq_category_attributes_category_key"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(80))
    label: Mapped[str] = mapped_column(String(120))
    value_type: Mapped[str] = mapped_column(String(16), default="text", server_default="text")
    required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    applies_to_variant: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class CatalogBrand(Base):
    __tablename__ = "catalog_brands"
    __table_args__ = (
        CheckConstraint("name <> '' AND slug <> ''", name="ck_catalog_brands_name_slug"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Shop(Base):
    __tablename__ = "shops"
    __table_args__ = (
        CheckConstraint("name <> '' AND slug <> ''", name="ck_shops_name_slug"),
        CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_shops_latitude_range",
        ),
        CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_shops_longitude_range",
        ),
        Index("ix_shops_location", "province", "city"),
        CheckConstraint("slot BETWEEN 1 AND 3", name="ck_shops_slot"),
        UniqueConstraint("owner_user_id", "slot", name="uq_shops_owner_slot"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    owner_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        ForeignKey("vendor_profiles.user_id", ondelete="RESTRICT"),
        index=True,
    )
    slot: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(String(320))
    city: Mapped[str] = mapped_column(String(80), index=True)
    province: Mapped[str] = mapped_column(String(80), index=True)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    logo_object_name: Mapped[str | None] = mapped_column(String(240))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Product(Base):
    __tablename__ = "catalog_products"
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_catalog_products_price_positive"),
        CheckConstraint("stock >= 0", name="ck_catalog_products_stock_nonnegative"),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="ck_catalog_products_status"
        ),
        UniqueConstraint("shop_id", "sku", name="uq_catalog_products_shop_sku"),
        Index("ix_catalog_products_discovery", "status", "category_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    shop_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("shops.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_categories.id", ondelete="RESTRICT"), index=True
    )
    brand_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_brands.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(180), index=True)
    slug: Mapped[str] = mapped_column(String(220), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text)
    sku: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    stock: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    attributes: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    moderation_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ProductVariant(Base):
    __tablename__ = "product_variants"
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_product_variants_price_positive"),
        CheckConstraint("stock >= 0", name="ck_product_variants_stock_nonnegative"),
        UniqueConstraint("product_id", "sku", name="uq_product_variants_product_sku"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    sku: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    stock: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    attributes: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductImage(Base):
    __tablename__ = "product_images"
    __table_args__ = (
        CheckConstraint("sort_order >= 0", name="ck_product_images_sort_order_nonnegative"),
        UniqueConstraint("product_id", "object_name", name="uq_product_images_product_object"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    object_name: Mapped[str] = mapped_column(String(240), unique=True)
    alt_text: Mapped[str] = mapped_column(String(180), default="", server_default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("catalog_products.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
