"""Add profile account settings without rewriting historical profiles."""

import sqlalchemy as sa
from alembic import op

revision = "0011_account_details"
down_revision = "0010_delivery_tracking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_details",
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("first_name", sa.String(120)),
        sa.Column("last_name", sa.String(120)),
        sa.Column("phone", sa.String(32)),
        sa.Column("preferred_categories", sa.JSON(), nullable=False),
        sa.Column("communication_email", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("communication_sms", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("business_category", sa.String(120)),
        sa.Column("registration_number", sa.String(120)),
        sa.Column("payout_preference", sa.String(20)),
        sa.Column("business_description", sa.String(1000)),
        sa.Column("avatar_object_name", sa.String(512)),
        sa.Column("avatar_content_type", sa.String(32)),
        sa.CheckConstraint(
            "payout_preference IS NULL OR payout_preference IN ('manual', 'bank_transfer')",
            name="ck_account_details_payout_preference",
        ),
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM account_details)")):
        raise RuntimeError(
            "Downgrade would discard account settings. Export and reconcile them first."
        )
    op.drop_table("account_details")
