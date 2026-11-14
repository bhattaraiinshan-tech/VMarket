"""Persist vendor-reported delivery milestones and customer delivery feedback."""

import sqlalchemy as sa
from alembic import op

revision = "0010_delivery_tracking"
down_revision = "0009_fraud_workspace_scope"
branch_labels = None
depends_on = None

LEGACY_STATUSES = (
    "status IN ('pending', 'confirmed', 'processing', 'shipped', 'delivered', "
    "'cancelled', 'return_requested', 'returned')"
)
TRACKING_STATUSES = (
    "status IN ('pending', 'confirmed', 'processing', 'shipped', 'picked_up', "
    "'in_transit', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned')"
)


def upgrade() -> None:
    op.add_column("fulfillment_orders", sa.Column("courier_name", sa.String(120), nullable=True))
    op.add_column("fulfillment_orders", sa.Column("support_phone", sa.String(32), nullable=True))
    op.add_column("fulfillment_orders", sa.Column("support_email", sa.String(254), nullable=True))
    op.add_column("order_status_events", sa.Column("location", sa.String(180), nullable=True))
    op.drop_constraint("ck_fulfillment_orders_status", "fulfillment_orders", type_="check")
    op.create_check_constraint(
        "ck_fulfillment_orders_status", "fulfillment_orders", TRACKING_STATUSES
    )
    op.create_table(
        "delivery_feedback",
        sa.Column(
            "fulfillment_order_id",
            sa.Uuid(),
            sa.ForeignKey("fulfillment_orders.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "customer_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("rating BETWEEN 1 AND 5", name="ck_delivery_feedback_rating"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM delivery_feedback) OR EXISTS("
            "SELECT 1 FROM fulfillment_orders WHERE courier_name IS NOT NULL "
            "OR support_phone IS NOT NULL OR support_email IS NOT NULL "
            "OR status IN ('picked_up', 'in_transit', 'out_for_delivery')) OR EXISTS("
            "SELECT 1 FROM order_status_events WHERE location IS NOT NULL "
            "OR to_status IN ('picked_up', 'in_transit', 'out_for_delivery') "
            "OR from_status IN ('picked_up', 'in_transit', 'out_for_delivery'))"
        )
    ):
        raise RuntimeError(
            "Downgrade would discard delivery tracking or feedback. "
            "Export and reconcile these records with an operator-reviewed rollback first."
        )
    op.drop_table("delivery_feedback")
    op.drop_constraint("ck_fulfillment_orders_status", "fulfillment_orders", type_="check")
    op.create_check_constraint(
        "ck_fulfillment_orders_status", "fulfillment_orders", LEGACY_STATUSES
    )
    op.drop_column("order_status_events", "location")
    for column in ("support_email", "support_phone", "courier_name"):
        op.drop_column("fulfillment_orders", column)
