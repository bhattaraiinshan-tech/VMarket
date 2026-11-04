"""Add catalogue, shop discovery, moderation, and wishlists.

Revision ID: 0003_catalog_discovery
Revises: 0002_identity_access
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0003_catalog_discovery"
down_revision: str | None = "0002_identity_access"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "catalog_categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=140), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("name <> '' AND slug <> ''", name="ck_catalog_categories_name_slug"),
        sa.ForeignKeyConstraint(["parent_id"], ["catalog_categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_categories_parent_id", "catalog_categories", ["parent_id"])
    op.create_index(
        "ix_catalog_categories_parent_active",
        "catalog_categories",
        ["parent_id", "is_active"],
    )
    op.create_index("ix_catalog_categories_slug", "catalog_categories", ["slug"], unique=True)

    op.create_table(
        "category_attributes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("value_type", sa.String(length=16), server_default="text", nullable=False),
        sa.Column("required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "applies_to_variant", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.CheckConstraint(
            "value_type IN ('text', 'number', 'boolean')",
            name="ck_category_attributes_value_type",
        ),
        sa.ForeignKeyConstraint(["category_id"], ["catalog_categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("category_id", "key", name="uq_category_attributes_category_key"),
    )
    op.create_index("ix_category_attributes_category_id", "category_attributes", ["category_id"])

    op.create_table(
        "catalog_brands",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=140), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("name <> '' AND slug <> ''", name="ck_catalog_brands_name_slug"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_brands_slug", "catalog_brands", ["slug"], unique=True)

    op.create_table(
        "shops",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("address", sa.String(length=320), nullable=True),
        sa.Column("city", sa.String(length=80), nullable=False),
        sa.Column("province", sa.String(length=80), nullable=False),
        sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("longitude", sa.Numeric(precision=9, scale=6), nullable=True),
        sa.Column("logo_object_name", sa.String(length=240), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("name <> '' AND slug <> ''", name="ck_shops_name_slug"),
        sa.CheckConstraint(
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
            name="ck_shops_latitude_range",
        ),
        sa.CheckConstraint(
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
            name="ck_shops_longitude_range",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_shops_city", "shops", ["city"])
    op.create_index("ix_shops_owner_user_id", "shops", ["owner_user_id"], unique=True)
    op.create_index("ix_shops_province", "shops", ["province"])
    op.create_index("ix_shops_location", "shops", ["province", "city"])
    op.create_index("ix_shops_slug", "shops", ["slug"], unique=True)

    op.create_table(
        "catalog_products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("shop_id", sa.Uuid(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("brand_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("slug", sa.String(length=220), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("stock", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("moderation_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("price > 0", name="ck_catalog_products_price_positive"),
        sa.CheckConstraint("stock >= 0", name="ck_catalog_products_stock_nonnegative"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_catalog_products_status",
        ),
        sa.ForeignKeyConstraint(["brand_id"], ["catalog_brands.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["category_id"], ["catalog_categories.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "sku", name="uq_catalog_products_shop_sku"),
    )
    op.create_index("ix_catalog_products_brand_id", "catalog_products", ["brand_id"])
    op.create_index("ix_catalog_products_category_id", "catalog_products", ["category_id"])
    op.create_index(
        "ix_catalog_products_discovery", "catalog_products", ["status", "category_id", "created_at"]
    )
    op.create_index("ix_catalog_products_name", "catalog_products", ["name"])
    op.create_index("ix_catalog_products_shop_id", "catalog_products", ["shop_id"])
    op.create_index("ix_catalog_products_slug", "catalog_products", ["slug"], unique=True)

    op.create_table(
        "product_variants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sku", sa.String(length=80), nullable=False),
        sa.Column("price", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("stock", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("price > 0", name="ck_product_variants_price_positive"),
        sa.CheckConstraint("stock >= 0", name="ck_product_variants_stock_nonnegative"),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "sku", name="uq_product_variants_product_sku"),
    )
    op.create_index("ix_product_variants_product_id", "product_variants", ["product_id"])

    op.create_table(
        "product_images",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("object_name", sa.String(length=240), nullable=False),
        sa.Column("alt_text", sa.String(length=180), server_default="", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("sort_order >= 0", name="ck_product_images_sort_order_nonnegative"),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("product_id", "object_name", name="uq_product_images_product_object"),
        sa.UniqueConstraint("object_name"),
    )
    op.create_index("ix_product_images_product_id", "product_images", ["product_id"])

    op.create_table(
        "wishlist_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["product_id"], ["catalog_products.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "product_id", name="uq_wishlist_user_product"),
    )
    op.create_index("ix_wishlist_items_product_id", "wishlist_items", ["product_id"])
    op.create_index("ix_wishlist_items_user_id", "wishlist_items", ["user_id"])


def downgrade() -> None:
    op.drop_table("wishlist_items")
    op.drop_table("product_images")
    op.drop_table("product_variants")
    op.drop_table("catalog_products")
    op.drop_table("shops")
    op.drop_table("catalog_brands")
    op.drop_table("category_attributes")
    op.drop_table("catalog_categories")
