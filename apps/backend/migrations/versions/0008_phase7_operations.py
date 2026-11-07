"""Add operational oversight, promotions, and fraud investigations.

Revision ID: 0008_phase7_operations
Revises: 0007_profile_workspace_isolation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision: str = "0008_phase7_operations"
down_revision: str | None = "0007_profile_workspace_isolation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("commission_rate_bps", sa.Integer(), server_default="300", nullable=False),
        sa.Column("return_window_days", sa.Integer(), server_default="7", nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_platform_settings_singleton"),
        sa.CheckConstraint(
            "commission_rate_bps BETWEEN 300 AND 500",
            name="ck_platform_settings_commission_range",
        ),
        sa.CheckConstraint(
            "return_window_days BETWEEN 1 AND 30",
            name="ck_platform_settings_return_window",
        ),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(
        sa.table(
            "platform_settings",
            sa.column("id", sa.Integer()),
            sa.column("commission_rate_bps", sa.Integer()),
            sa.column("return_window_days", sa.Integer()),
        ),
        [{"id": 1, "commission_rate_bps": 300, "return_window_days": 7}],
    )
    op.create_table(
        "promotions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("discount_type", sa.String(length=12), nullable=False),
        sa.Column("discount_value", sa.Numeric(12, 2), nullable=False),
        sa.Column("sponsor_type", sa.String(length=12), nullable=False),
        sa.Column("shop_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_redemptions", sa.Integer(), nullable=True),
        sa.Column("redemption_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "discount_type IN ('percent', 'fixed')",
            name="ck_promotions_discount_type",
        ),
        sa.CheckConstraint("discount_value > 0", name="ck_promotions_discount_value_positive"),
        sa.CheckConstraint(
            "discount_type <> 'percent' OR discount_value <= 100",
            name="ck_promotions_percent_max",
        ),
        sa.CheckConstraint(
            "sponsor_type IN ('platform', 'vendor')",
            name="ck_promotions_sponsor_type",
        ),
        sa.CheckConstraint(
            "(sponsor_type = 'platform' AND shop_id IS NULL) OR "
            "(sponsor_type = 'vendor' AND shop_id IS NOT NULL)",
            name="ck_promotions_sponsor_shop",
        ),
        sa.CheckConstraint(
            "starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at",
            name="ck_promotions_dates",
        ),
        sa.CheckConstraint(
            "max_redemptions IS NULL OR max_redemptions > 0",
            name="ck_promotions_redemption_limit",
        ),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_promotions_code", "promotions", ["code"], unique=True)
    op.create_index("ix_promotions_shop_id", "promotions", ["shop_id"])
    op.create_index(
        "ix_promotions_active_dates",
        "promotions",
        ["is_active", "starts_at", "ends_at"],
    )
    op.create_table(
        "fraud_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reporter_id", sa.Uuid(), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("investigation_notes", sa.Text(), nullable=True),
        sa.Column("investigated_by_id", sa.Uuid(), nullable=True),
        sa.Column("investigated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "target_type IN ('product', 'shop', 'order', 'review', 'vendor')",
            name="ck_fraud_reports_target_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'investigating', 'resolved', 'dismissed')",
            name="ck_fraud_reports_status",
        ),
        sa.CheckConstraint("length(reason) > 0", name="ck_fraud_reports_reason"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["investigated_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "reporter_id",
            "target_type",
            "target_id",
            name="uq_fraud_reports_reporter_target",
        ),
    )
    op.create_index("ix_fraud_reports_reporter_id", "fraud_reports", ["reporter_id"])
    op.create_index("ix_fraud_reports_status_created", "fraud_reports", ["status", "created_at"])
    op.create_index("ix_fraud_reports_target", "fraud_reports", ["target_type", "target_id"])
    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("promotion_id", sa.Uuid(), nullable=True))
        batch_op.add_column(
            sa.Column("discount_total", sa.Numeric(14, 2), server_default="0", nullable=False)
        )
        batch_op.create_foreign_key(
            "fk_orders_promotion_id_promotions",
            "promotions",
            ["promotion_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_orders_promotion_id", ["promotion_id"])
        batch_op.create_check_constraint(
            "ck_orders_discount_within_subtotal",
            "discount_total >= 0 AND discount_total <= subtotal",
        )
    with op.batch_alter_table("fulfillment_orders") as batch_op:
        batch_op.add_column(
            sa.Column("discount_total", sa.Numeric(14, 2), server_default="0", nullable=False)
        )
        batch_op.add_column(
            sa.Column("commission_rate_bps", sa.Integer(), server_default="300", nullable=False)
        )
        batch_op.add_column(
            sa.Column("commission_amount", sa.Numeric(14, 2), server_default="0", nullable=False)
        )
        batch_op.create_check_constraint(
            "ck_fulfillment_orders_discount_within_subtotal",
            "discount_total >= 0 AND discount_total <= subtotal",
        )
        batch_op.create_check_constraint(
            "ck_fulfillment_orders_commission_nonnegative",
            "commission_amount >= 0",
        )
        batch_op.create_check_constraint(
            "ck_fulfillment_orders_commission_rate",
            "commission_rate_bps BETWEEN 300 AND 500",
        )


def downgrade() -> None:
    connection: Connection = op.get_bind()
    unsafe = connection.execute(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM promotions) "
            "OR EXISTS (SELECT 1 FROM fraud_reports) "
            "OR EXISTS (SELECT 1 FROM orders "
            "WHERE promotion_id IS NOT NULL OR discount_total <> 0) "
            "OR EXISTS (SELECT 1 FROM fulfillment_orders "
            "WHERE discount_total <> 0 OR commission_amount <> 0 OR commission_rate_bps <> 300) "
            "OR EXISTS (SELECT 1 FROM platform_settings "
            "WHERE commission_rate_bps <> 300 OR return_window_days <> 7)"
        )
    ).scalar()
    if unsafe:
        raise RuntimeError(
            "0008_phase7_operations: refusing to discard promotions, reports, "
            "order snapshots, or changed platform settings"
        )
    with op.batch_alter_table("fulfillment_orders") as batch_op:
        batch_op.drop_constraint("ck_fulfillment_orders_commission_rate", type_="check")
        batch_op.drop_constraint("ck_fulfillment_orders_commission_nonnegative", type_="check")
        batch_op.drop_constraint("ck_fulfillment_orders_discount_within_subtotal", type_="check")
        batch_op.drop_column("commission_amount")
        batch_op.drop_column("commission_rate_bps")
        batch_op.drop_column("discount_total")
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_constraint("ck_orders_discount_within_subtotal", type_="check")
        batch_op.drop_index("ix_orders_promotion_id")
        batch_op.drop_constraint("fk_orders_promotion_id_promotions", type_="foreignkey")
        batch_op.drop_column("discount_total")
        batch_op.drop_column("promotion_id")
    op.drop_index("ix_fraud_reports_target", table_name="fraud_reports")
    op.drop_index("ix_fraud_reports_status_created", table_name="fraud_reports")
    op.drop_index("ix_fraud_reports_reporter_id", table_name="fraud_reports")
    op.drop_table("fraud_reports")
    op.drop_index("ix_promotions_active_dates", table_name="promotions")
    op.drop_index("ix_promotions_shop_id", table_name="promotions")
    op.drop_index("ix_promotions_code", table_name="promotions")
    op.drop_table("promotions")
    op.drop_table("platform_settings")
