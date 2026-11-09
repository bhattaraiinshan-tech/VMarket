from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, Shop
from app.communications.models import ProductReview, SupportTicket
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import (
    WorkspaceContext,
    get_current_admin,
    get_current_user,
    get_selected_shop,
    get_workspace_context,
)
from app.identity.models import AuditLog, User, VendorApplication, VendorProfile
from app.operations.models import FraudReport, PlatformSettings, Promotion
from app.operations.schemas import (
    AdminOrderRead,
    AdminPaymentRead,
    FraudReportCreate,
    FraudReportRead,
    FraudReportUpdate,
    OperationsDashboardRead,
    PlatformSettingsRead,
    PlatformSettingsUpdate,
    PromotionCreate,
    PromotionRead,
    PromotionStatusUpdate,
)
from app.orders.access import require_order_access
from app.orders.models import CustomerOrder, FulfillmentOrder, PaymentTransaction

router = APIRouter(tags=["operations"])


def _audit(
    session: AsyncSession,
    actor_id: UUID,
    action: str,
    target_type: str,
    target_id: UUID | str,
    details: str | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            details=details,
        )
    )


async def _platform_settings(session: AsyncSession, *, lock: bool = False) -> PlatformSettings:
    query = select(PlatformSettings).where(PlatformSettings.id == 1)
    if lock:
        query = query.with_for_update()
    settings = await session.scalar(query)
    if settings is None:
        raise APIError(
            503,
            "platform_settings_unavailable",
            "Platform settings are unavailable. Apply the latest database migration.",
        )
    return settings


@router.get("/admin/dashboard", response_model=OperationsDashboardRead)
async def admin_operations_dashboard(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OperationsDashboardRead:
    _ = admin
    await _platform_settings(session)
    return OperationsDashboardRead(
        users_total=await session.scalar(select(func.count(User.id))) or 0,
        active_vendors=await session.scalar(
            select(func.count(VendorProfile.user_id))
            .join(User, User.id == VendorProfile.user_id)
            .where(User.account_status == "active")
        )
        or 0,
        pending_vendor_applications=await session.scalar(
            select(func.count(VendorApplication.id)).where(VendorApplication.status == "pending")
        )
        or 0,
        pending_products=await session.scalar(
            select(func.count(Product.id)).where(Product.status == "pending")
        )
        or 0,
        orders_total=await session.scalar(select(func.count(CustomerOrder.id))) or 0,
        open_orders=await session.scalar(
            select(func.count(CustomerOrder.id)).where(
                CustomerOrder.status.in_(("pending", "in_progress", "return_requested"))
            )
        )
        or 0,
        open_disputes=await session.scalar(
            select(func.count(SupportTicket.id)).where(
                SupportTicket.kind == "dispute",
                SupportTicket.status.in_(("open", "in_progress")),
            )
        )
        or 0,
        pending_fraud_reports=await session.scalar(
            select(func.count(FraudReport.id)).where(
                FraudReport.status.in_(("pending", "investigating"))
            )
        )
        or 0,
        pending_payments=await session.scalar(
            select(func.count(PaymentTransaction.id)).where(
                PaymentTransaction.status.in_(("pending", "refund_due"))
            )
        )
        or 0,
        collected_npr=await session.scalar(
            select(func.coalesce(func.sum(PaymentTransaction.amount), 0)).where(
                PaymentTransaction.transaction_type == "charge",
                PaymentTransaction.status == "collected",
            )
        )
        or Decimal("0.00"),
        refunds_due_npr=await session.scalar(
            select(func.coalesce(func.sum(PaymentTransaction.amount), 0)).where(
                PaymentTransaction.transaction_type == "refund",
                PaymentTransaction.status == "refund_due",
            )
        )
        or Decimal("0.00"),
        commission_accrued_npr=await session.scalar(
            select(func.coalesce(func.sum(FulfillmentOrder.commission_amount), 0)).where(
                FulfillmentOrder.status.not_in(("cancelled", "returned"))
            )
        )
        or Decimal("0.00"),
    )


@router.get("/admin/orders", response_model=list[AdminOrderRead])
async def admin_list_orders(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            pattern="^(pending|in_progress|completed|partially_cancelled|cancelled|return_requested|returned)$",
        ),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AdminOrderRead]:
    _ = admin
    query = (
        select(CustomerOrder, User.email, Promotion.code)
        .join(User, User.id == CustomerOrder.customer_id)
        .outerjoin(Promotion, Promotion.id == CustomerOrder.promotion_id)
        .order_by(CustomerOrder.created_at.desc())
        .limit(limit)
    )
    if status_filter:
        query = query.where(CustomerOrder.status == status_filter)
    rows = (await session.execute(query)).all()
    return [
        AdminOrderRead(
            id=order.id,
            customer_id=order.customer_id,
            customer_email=email,
            order_number=order.order_number,
            status=order.status,
            payment_method=order.payment_method,
            subtotal=order.subtotal,
            shipping_total=order.shipping_total,
            discount_total=order.discount_total,
            total=order.total,
            promotion_code=code,
            created_at=order.created_at,
            updated_at=order.updated_at,
        )
        for order, email, code in rows
    ]


@router.get("/admin/payments", response_model=list[AdminPaymentRead])
async def admin_list_payments(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: Annotated[
        str | None,
        Query(alias="status", pattern="^(pending|collected|cancelled|refund_due|refunded)$"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AdminPaymentRead]:
    _ = admin
    query = (
        select(
            PaymentTransaction, CustomerOrder.order_number, FulfillmentOrder.shop_name, User.email
        )
        .join(CustomerOrder, CustomerOrder.id == PaymentTransaction.order_id)
        .join(FulfillmentOrder, FulfillmentOrder.id == PaymentTransaction.fulfillment_order_id)
        .join(User, User.id == CustomerOrder.customer_id)
        .order_by(PaymentTransaction.created_at.desc())
        .limit(limit)
    )
    if status_filter:
        query = query.where(PaymentTransaction.status == status_filter)
    rows = (await session.execute(query)).all()
    return [
        AdminPaymentRead(
            id=payment.id,
            order_id=payment.order_id,
            order_number=order_number,
            fulfillment_order_id=payment.fulfillment_order_id,
            shop_name=shop_name,
            customer_email=email,
            transaction_type=payment.transaction_type,
            method=payment.method,
            status=payment.status,
            amount=payment.amount,
            created_at=payment.created_at,
            updated_at=payment.updated_at,
        )
        for payment, order_number, shop_name, email in rows
    ]


@router.get("/admin/settings", response_model=PlatformSettingsRead)
async def admin_get_platform_settings(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PlatformSettingsRead:
    _ = admin
    return PlatformSettingsRead.model_validate(await _platform_settings(session))


@router.patch("/admin/settings", response_model=PlatformSettingsRead)
async def admin_update_platform_settings(
    body: PlatformSettingsUpdate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PlatformSettingsRead:
    settings = await _platform_settings(session, lock=True)
    changes = body.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(settings, key, value)
    settings.updated_by_id = admin.id
    _audit(
        session,
        admin.id,
        "platform_settings_updated",
        "platform_settings",
        str(settings.id),
        ", ".join(f"{key}={value}" for key, value in sorted(changes.items())),
    )
    await session.commit()
    await session.refresh(settings)
    return PlatformSettingsRead.model_validate(settings)


@router.get("/admin/promotions", response_model=list[PromotionRead])
async def admin_list_promotions(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[PromotionRead]:
    _ = admin
    rows = await session.scalars(
        select(Promotion).order_by(Promotion.created_at.desc()).limit(limit)
    )
    return [PromotionRead.model_validate(item) for item in rows]


@router.post("/admin/promotions", response_model=PromotionRead, status_code=201)
async def admin_create_promotion(
    body: PromotionCreate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PromotionRead:
    promotion = Promotion(
        **body.model_dump(),
        sponsor_type="platform",
        shop_id=None,
        created_by_id=admin.id,
    )
    session.add(promotion)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "promotion_code_exists", "This promotion code is already in use."
        ) from None
    _audit(
        session, admin.id, "platform_promotion_created", "promotion", promotion.id, promotion.code
    )
    await session.commit()
    await session.refresh(promotion)
    return PromotionRead.model_validate(promotion)


@router.patch("/admin/promotions/{promotion_id}", response_model=PromotionRead)
async def admin_update_promotion_status(
    promotion_id: UUID,
    body: PromotionStatusUpdate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PromotionRead:
    promotion = await session.scalar(
        select(Promotion).where(Promotion.id == promotion_id).with_for_update()
    )
    if promotion is None:
        raise APIError(404, "promotion_not_found", "Promotion was not found.")
    promotion.is_active = body.is_active
    _audit(
        session,
        admin.id,
        "promotion_status_updated",
        "promotion",
        promotion.id,
        f"is_active={body.is_active}",
    )
    await session.commit()
    await session.refresh(promotion)
    return PromotionRead.model_validate(promotion)


@router.get("/vendor/promotions", response_model=list[PromotionRead])
async def vendor_list_promotions(
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PromotionRead]:
    rows = await session.scalars(
        select(Promotion)
        .where(Promotion.shop_id == shop.id)
        .order_by(Promotion.created_at.desc())
        .limit(50)
    )
    return [PromotionRead.model_validate(item) for item in rows]


@router.post("/vendor/promotions", response_model=PromotionRead, status_code=201)
async def vendor_create_promotion(
    body: PromotionCreate,
    vendor: Annotated[User, Depends(get_current_user)],
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PromotionRead:
    if shop.owner_user_id != vendor.id:
        raise APIError(403, "shop_access_denied", "The selected shop is not owned by this account.")
    promotion = Promotion(
        **body.model_dump(),
        sponsor_type="vendor",
        shop_id=shop.id,
        created_by_id=vendor.id,
    )
    session.add(promotion)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409, "promotion_code_exists", "This promotion code is already in use."
        ) from None
    _audit(
        session, vendor.id, "vendor_promotion_created", "promotion", promotion.id, promotion.code
    )
    await session.commit()
    await session.refresh(promotion)
    return PromotionRead.model_validate(promotion)


@router.post("/me/fraud-reports", response_model=FraudReportRead, status_code=201)
async def create_fraud_report(
    body: FraudReportCreate,
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FraudReportRead:
    if context.workspace not in {"customer", "vendor"}:
        raise APIError(403, "report_workspace_required", "Select Customer or Vendor workspace.")
    if context.workspace == "vendor" and context.shop is None:
        raise APIError(422, "shop_context_required", "Select a shop to continue.")
    entity: type[object] | None = {
        "product": Product,
        "shop": Shop,
        "order": CustomerOrder,
        "review": ProductReview,
        "vendor": VendorProfile,
    }.get(body.target_type)
    target = await session.get(entity, body.target_id) if entity is not None else None
    if target is None:
        raise APIError(404, "report_target_not_found", "The item you are reporting was not found.")
    if body.target_type == "order":
        await require_order_access(session, context, body.target_id)
    report = FraudReport(
        reporter_id=context.user.id,
        workspace=context.workspace,
        shop_id=context.shop.id if context.shop is not None else None,
        target_type=body.target_type,
        target_id=body.target_id,
        reason=body.reason,
        details=body.details,
    )
    session.add(report)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise APIError(
            409,
            "duplicate_fraud_report",
            "You have already submitted a report for this item.",
        ) from None
    await session.refresh(report)
    return FraudReportRead.model_validate(report)


@router.patch("/vendor/promotions/{promotion_id}", response_model=PromotionRead)
async def vendor_update_promotion_status(
    promotion_id: UUID,
    body: PromotionStatusUpdate,
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PromotionRead:
    promotion = await session.scalar(
        select(Promotion)
        .where(
            Promotion.id == promotion_id,
            Promotion.shop_id == shop.id,
            Promotion.sponsor_type == "vendor",
        )
        .with_for_update()
    )
    if promotion is None:
        raise APIError(404, "promotion_not_found", "Promotion was not found for the selected shop.")
    promotion.is_active = body.is_active
    _audit(
        session,
        shop.owner_user_id,
        "vendor_promotion_status_updated",
        "promotion",
        promotion.id,
        f"is_active={body.is_active}",
    )
    await session.commit()
    await session.refresh(promotion)
    return PromotionRead.model_validate(promotion)


@router.get("/admin/fraud-reports", response_model=list[FraudReportRead])
async def admin_list_fraud_reports(
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: Annotated[
        str | None,
        Query(alias="status", pattern="^(pending|investigating|resolved|dismissed)$"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[FraudReportRead]:
    _ = admin
    query = (
        select(FraudReport, User.email)
        .join(User, User.id == FraudReport.reporter_id)
        .order_by(FraudReport.created_at.asc())
        .limit(limit)
    )
    if status_filter:
        query = query.where(FraudReport.status == status_filter)
    return [
        FraudReportRead(
            **FraudReportRead.model_validate(report).model_dump(exclude={"reporter_email"}),
            reporter_email=email,
        )
        for report, email in (await session.execute(query)).all()
    ]


@router.patch("/admin/fraud-reports/{report_id}", response_model=FraudReportRead)
async def admin_update_fraud_report(
    report_id: UUID,
    body: FraudReportUpdate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FraudReportRead:
    report = await session.scalar(
        select(FraudReport).where(FraudReport.id == report_id).with_for_update()
    )
    if report is None:
        raise APIError(404, "fraud_report_not_found", "Fraud report was not found.")
    report.status = body.status
    report.investigation_notes = body.investigation_notes
    report.investigated_by_id = admin.id
    report.investigated_at = datetime.now(timezone.utc)
    _audit(
        session,
        admin.id,
        "fraud_report_investigated",
        "fraud_report",
        report.id,
        f"status={body.status}",
    )
    await session.commit()
    await session.refresh(report)
    reporter = await session.get(User, report.reporter_id)
    result = FraudReportRead.model_validate(report)
    result.reporter_email = reporter.email if reporter is not None else None
    return result
