"""Add identity, access control, vendor verification, and audit data.

Revision ID: 0002_identity_access
Revises: 0001_foundation
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0002_identity_access"
down_revision: str | None = "0001_foundation"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=256), nullable=False),
        sa.Column("email_verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("account_status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "account_status IN ('active', 'suspended', 'deactivated')",
            name="ck_users_account_status",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_account_status", "users", ["account_status"])
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.CheckConstraint("role IN ('customer', 'vendor', 'admin')", name="ck_user_roles_role"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "role"),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_token_hash", "auth_sessions", ["token_hash"], unique=True)
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])

    op.create_table(
        "identity_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name="ck_identity_tokens_purpose",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_identity_tokens_user_id", "identity_tokens", ["user_id"])
    op.create_index("ix_identity_tokens_token_hash", "identity_tokens", ["token_hash"], unique=True)
    op.create_index("ix_identity_tokens_expires_at", "identity_tokens", ["expires_at"])

    op.create_table(
        "customer_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
        sa.UniqueConstraint("phone", name="uq_customer_profiles_phone"),
    )

    op.create_table(
        "delivery_addresses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=40), nullable=False),
        sa.Column("recipient_name", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("province", sa.String(length=80), nullable=False),
        sa.Column("city", sa.String(length=80), nullable=False),
        sa.Column("area", sa.String(length=120), nullable=True),
        sa.Column("street_address", sa.String(length=240), nullable=False),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("province <> '' AND city <> ''", name="ck_address_location_required"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_delivery_addresses_user_id", "delivery_addresses", ["user_id"])
    op.create_index(
        "uq_delivery_addresses_default_per_user",
        "delivery_addresses",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        sqlite_where=sa.text("is_default = 1"),
    )

    op.create_table(
        "vendor_applications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("business_name", sa.String(length=160), nullable=False),
        sa.Column("business_type", sa.String(length=80), nullable=False),
        sa.Column("registration_number", sa.String(length=80), nullable=True),
        sa.Column("business_address", sa.String(length=320), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("review_notes", sa.Text(), nullable=True),
        sa.Column(
            "submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_vendor_applications_status",
        ),
        sa.ForeignKeyConstraint(["reviewed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vendor_applications_user_id", "vendor_applications", ["user_id"])
    op.create_index("ix_vendor_applications_status", "vendor_applications", ["status"])
    op.create_index(
        "uq_vendor_applications_active_per_user",
        "vendor_applications",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'approved')"),
        sqlite_where=sa.text("status IN ('pending', 'approved')"),
    )

    op.create_table(
        "vendor_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=False),
        sa.Column("document_type", sa.String(length=40), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("object_name", sa.String(length=180), nullable=False),
        sa.Column("content_type", sa.String(length=80), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("file_size > 0", name="ck_vendor_documents_file_size"),
        sa.ForeignKeyConstraint(["application_id"], ["vendor_applications.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_name", name="uq_vendor_documents_object_name"),
    )
    op.create_index("ix_vendor_documents_application_id", "vendor_documents", ["application_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("target_type", sa.String(length=80), nullable=False),
        sa.Column("target_id", sa.String(length=80), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "actor_id IS NOT NULL OR action = 'admin_role_granted'",
            name="ck_audit_logs_actor_required",
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_actor_id", "audit_logs", ["actor_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_target_id", "audit_logs", ["target_id"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    op.execute(
        """
        CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_logs is append-only';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_log_mutation()")
    for index_name, table_name in (
        ("ix_audit_logs_created_at", "audit_logs"),
        ("ix_audit_logs_target_id", "audit_logs"),
        ("ix_audit_logs_action", "audit_logs"),
        ("ix_audit_logs_actor_id", "audit_logs"),
        ("ix_vendor_documents_application_id", "vendor_documents"),
        ("uq_vendor_applications_active_per_user", "vendor_applications"),
        ("ix_vendor_applications_status", "vendor_applications"),
        ("ix_vendor_applications_user_id", "vendor_applications"),
        ("uq_delivery_addresses_default_per_user", "delivery_addresses"),
        ("ix_delivery_addresses_user_id", "delivery_addresses"),
        ("ix_identity_tokens_expires_at", "identity_tokens"),
        ("ix_identity_tokens_token_hash", "identity_tokens"),
        ("ix_identity_tokens_user_id", "identity_tokens"),
        ("ix_auth_sessions_expires_at", "auth_sessions"),
        ("ix_auth_sessions_token_hash", "auth_sessions"),
        ("ix_auth_sessions_user_id", "auth_sessions"),
        ("ix_users_email", "users"),
        ("ix_users_account_status", "users"),
    ):
        op.drop_index(index_name, table_name=table_name)
    for table_name in (
        "audit_logs",
        "vendor_documents",
        "vendor_applications",
        "delivery_addresses",
        "customer_profiles",
        "identity_tokens",
        "auth_sessions",
        "user_roles",
        "users",
    ):
        op.drop_table(table_name)
