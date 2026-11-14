from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "account_status IN ('active', 'suspended', 'deactivated')",
            name="ck_users_account_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    account_status: Mapped[str] = mapped_column(
        String(20), default="active", server_default="active", index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    roles: Mapped[list["UserRole"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    profile: Mapped["CustomerProfile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    vendor_profile: Mapped["VendorProfile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )
    owner_binding: Mapped["PlatformOwner | None"] = relationship(uselist=False)
    addresses: Mapped[list["DeliveryAddress"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        CheckConstraint("role IN ('customer', 'vendor', 'admin')", name="ck_user_roles_role"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(20), primary_key=True)

    user: Mapped[User] = relationship(back_populates="roles")


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IdentityToken(Base):
    __tablename__ = "identity_tokens"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('email_verification', 'password_reset')",
            name="ck_identity_tokens_purpose",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    purpose: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomerProfile(Base):
    __tablename__ = "customer_profiles"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="profile")


class AccountDetails(Base):
    __tablename__ = "account_details"
    __table_args__ = (
        CheckConstraint(
            "payout_preference IS NULL OR payout_preference IN ('manual', 'bank_transfer')",
            name="ck_account_details_payout_preference",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(32))
    preferred_categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    communication_email: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    communication_sms: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    business_category: Mapped[str | None] = mapped_column(String(120))
    registration_number: Mapped[str | None] = mapped_column(String(120))
    payout_preference: Mapped[str | None] = mapped_column(String(20))
    business_description: Mapped[str | None] = mapped_column(String(1000))
    avatar_object_name: Mapped[str | None] = mapped_column(String(512))
    avatar_content_type: Mapped[str | None] = mapped_column(String(32))


class VendorProfile(Base):
    __tablename__ = "vendor_profiles"

    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    business_name: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="vendor_profile")


class PlatformOwner(Base):
    __tablename__ = "platform_owner"
    __table_args__ = (CheckConstraint("id = 1", name="ck_platform_owner_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DeliveryAddress(Base):
    __tablename__ = "delivery_addresses"
    __table_args__ = (
        CheckConstraint("province <> '' AND city <> ''", name="ck_address_location_required"),
        Index(
            "uq_delivery_addresses_default_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default = 1"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(40))
    recipient_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32))
    province: Mapped[str] = mapped_column(String(80))
    city: Mapped[str] = mapped_column(String(80))
    area: Mapped[str | None] = mapped_column(String(120))
    street_address: Mapped[str] = mapped_column(String(240))
    postal_code: Mapped[str | None] = mapped_column(String(20))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="addresses")


class VendorApplication(Base):
    __tablename__ = "vendor_applications"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="ck_vendor_applications_status"
        ),
        Index(
            "uq_vendor_applications_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'approved')"),
            sqlite_where=text("status IN ('pending', 'approved')"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    business_name: Mapped[str] = mapped_column(String(160))
    business_type: Mapped[str] = mapped_column(String(80))
    registration_number: Mapped[str | None] = mapped_column(String(80))
    business_address: Mapped[str] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(
        String(20), default="pending", server_default="pending", index=True
    )
    review_notes: Mapped[str | None] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    documents: Mapped[list["VendorDocument"]] = relationship(
        back_populates="application", cascade="all, delete-orphan"
    )


class VendorDocument(Base):
    __tablename__ = "vendor_documents"
    __table_args__ = (CheckConstraint("file_size > 0", name="ck_vendor_documents_file_size"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    application_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("vendor_applications.id", ondelete="CASCADE"), index=True
    )
    document_type: Mapped[str] = mapped_column(String(40))
    original_filename: Mapped[str] = mapped_column(String(255))
    object_name: Mapped[str] = mapped_column(String(180), unique=True)
    content_type: Mapped[str] = mapped_column(String(80))
    file_size: Mapped[int] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    application: Mapped[VendorApplication] = relationship(back_populates="documents")


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_id IS NOT NULL OR action = 'admin_role_granted'",
            name="ck_audit_logs_actor_required",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    actor_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(80))
    target_id: Mapped[str] = mapped_column(String(80), index=True)
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
