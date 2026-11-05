import asyncio
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, Shop
from app.communications.models import (
    Conversation,
    ConversationMessage,
    ProductReview,
    ReviewReport,
    SupportTicket,
)
from app.communications.schemas import (
    ConversationCreate,
    ConversationRead,
    MessageCreate,
    MessageRead,
    ReviewCreate,
    ReviewModerationUpdate,
    ReviewRead,
    ReviewReportCreate,
    ReviewReportRead,
    SupportTicketCreate,
    SupportTicketRead,
    SupportTicketUpdate,
    VendorReviewResponse,
)
from app.core.config import get_settings
from app.core.errors import APIError
from app.db.session import get_session, get_session_factory
from app.identity.dependencies import get_current_admin, get_current_user
from app.identity.models import AuditLog, AuthSession, CustomerProfile, User, UserRole
from app.identity.security import hash_token
from app.orders.models import (
    CustomerOrder,
    FulfillmentOrder,
    OrderItem,
    OrderNotification,
)

router = APIRouter(tags=["communications"])


class ConversationConnections:
    def __init__(self) -> None:
        self._connections: dict[UUID, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, conversation_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.setdefault(conversation_id, set()).add(websocket)

    async def disconnect(self, conversation_id: UUID, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections.get(conversation_id)
            if connections is None:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(conversation_id, None)

    async def publish(self, conversation_id: UUID, message: MessageRead) -> None:
        async with self._lock:
            connections = tuple(self._connections.get(conversation_id, ()))
        payload = message.model_dump(mode="json")
        for websocket in connections:
            try:
                await websocket.send_json(payload)
            except (RuntimeError, WebSocketDisconnect):
                await self.disconnect(conversation_id, websocket)


connections = ConversationConnections()


async def _conversation(
    session: AsyncSession,
    user: User,
    conversation_id: UUID,
) -> tuple[Conversation, Shop]:
    result = await session.execute(
        select(Conversation, Shop)
        .join(Shop, Shop.id == Conversation.shop_id)
        .where(Conversation.id == conversation_id)
    )
    row = result.first()
    if row is None:
        raise APIError(404, "conversation_not_found", "The conversation was not found.")
    conversation, shop = row
    if user.id not in {conversation.customer_id, shop.owner_user_id}:
        raise APIError(404, "conversation_not_found", "The conversation was not found.")
    return conversation, shop


async def _conversation_read(
    session: AsyncSession,
    user: User,
    conversation: Conversation,
    shop: Shop,
) -> ConversationRead:
    profile = await session.get(CustomerProfile, conversation.customer_id)
    last_message = await session.scalar(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation.id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .limit(1)
    )
    unread_count = await session.scalar(
        select(func.count(ConversationMessage.id)).where(
            ConversationMessage.conversation_id == conversation.id,
            ConversationMessage.sender_id != user.id,
            ConversationMessage.read_at.is_(None),
        )
    )
    product = (
        await session.get(Product, conversation.product_id) if conversation.product_id else None
    )
    return ConversationRead(
        id=conversation.id,
        shop_id=shop.id,
        shop_owner_id=shop.owner_user_id,
        shop_name=shop.name,
        customer_id=conversation.customer_id,
        customer_name=profile.full_name if profile else "Customer",
        current_user_id=user.id,
        product_id=conversation.product_id,
        product_name=product.name if product else None,
        order_id=conversation.order_id,
        unread_count=unread_count or 0,
        last_message=MessageRead.model_validate(last_message) if last_message else None,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


async def _review_read(
    session: AsyncSession,
    review: ProductReview,
) -> ReviewRead:
    profile = await session.get(CustomerProfile, review.customer_id)
    product = await session.get(Product, review.product_id)
    return ReviewRead(
        id=review.id,
        product_id=review.product_id,
        product_name=product.name if product else "Product",
        order_item_id=review.order_item_id,
        customer_name=profile.full_name if profile else "Customer",
        rating=review.rating,
        title=review.title,
        body=review.body,
        moderation_status=review.moderation_status,
        vendor_response=review.vendor_response,
        created_at=review.created_at,
        vendor_responded_at=review.vendor_responded_at,
    )


async def _review_report_read(
    session: AsyncSession,
    report: ReviewReport,
) -> ReviewReportRead:
    review = await session.get(ProductReview, report.review_id)
    if review is None:
        raise APIError(404, "review_not_found", "The reported review was not found.")
    return ReviewReportRead(
        id=report.id,
        review_id=report.review_id,
        reporter_id=report.reporter_id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        resolved_by_id=report.resolved_by_id,
        resolved_at=report.resolved_at,
        created_at=report.created_at,
        review=await _review_read(session, review),
    )


async def _ticket_order_access(
    session: AsyncSession,
    user: User,
    order_id: UUID,
) -> CustomerOrder:
    order = await session.get(CustomerOrder, order_id)
    if order is None:
        raise APIError(404, "order_not_found", "The order was not found.")
    if order.customer_id == user.id:
        return order
    shop_id = await session.scalar(
        select(FulfillmentOrder.shop_id)
        .join(Shop, Shop.id == FulfillmentOrder.shop_id)
        .where(
            FulfillmentOrder.order_id == order.id,
            Shop.owner_user_id == user.id,
        )
        .limit(1)
    )
    if shop_id is None:
        raise APIError(404, "order_not_found", "The order was not found.")
    return order


@router.get("/me/conversations", response_model=list[ConversationRead])
async def list_conversations(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ConversationRead]:
    conversations = await session.scalars(
        select(Conversation)
        .join(Shop, Shop.id == Conversation.shop_id)
        .where((Conversation.customer_id == user.id) | (Shop.owner_user_id == user.id))
        .order_by(Conversation.updated_at.desc())
        .limit(100)
    )
    result: list[ConversationRead] = []
    for conversation in conversations:
        shop = await session.get(Shop, conversation.shop_id)
        if shop is not None:
            result.append(await _conversation_read(session, user, conversation, shop))
    return result


@router.get("/me/conversations/{conversation_id}", response_model=ConversationRead)
async def get_conversation(
    conversation_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationRead:
    conversation, shop = await _conversation(session, user, conversation_id)
    return await _conversation_read(session, user, conversation, shop)


@router.post("/me/conversations", response_model=ConversationRead, status_code=201)
async def start_conversation(
    payload: ConversationCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationRead:
    shop = await session.get(Shop, payload.shop_id)
    if shop is None or not shop.is_active:
        raise APIError(404, "shop_not_found", "The shop was not found.")
    if shop.owner_user_id == user.id:
        raise APIError(
            403, "own_shop_conversation", "You cannot start a customer conversation with your shop."
        )
    if payload.product_id is not None:
        product = await session.scalar(
            select(Product).where(
                Product.id == payload.product_id,
                Product.shop_id == shop.id,
                Product.status == "approved",
            )
        )
        if product is None:
            raise APIError(404, "product_not_found", "The product was not found in this shop.")
    if payload.order_id is not None:
        order = await _ticket_order_access(session, user, payload.order_id)
        owns_fulfillment = await session.scalar(
            select(FulfillmentOrder.id).where(
                FulfillmentOrder.order_id == order.id,
                FulfillmentOrder.shop_id == shop.id,
            )
        )
        if owns_fulfillment is None:
            raise APIError(404, "order_not_found", "The order was not found for this shop.")

    conversation = await session.scalar(
        select(Conversation).where(
            Conversation.customer_id == user.id,
            Conversation.shop_id == shop.id,
        )
    )
    if conversation is None:
        conversation = Conversation(
            customer_id=user.id,
            shop_id=shop.id,
            product_id=payload.product_id,
            order_id=payload.order_id,
        )
        session.add(conversation)
    else:
        conversation.product_id = conversation.product_id or payload.product_id
        conversation.order_id = conversation.order_id or payload.order_id
    await session.commit()
    await session.refresh(conversation)
    return await _conversation_read(session, user, conversation, shop)


@router.get(
    "/me/conversations/{conversation_id}/messages",
    response_model=list[MessageRead],
)
async def list_messages(
    conversation_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[MessageRead]:
    conversation, _ = await _conversation(session, user, conversation_id)
    await session.execute(
        update(ConversationMessage)
        .where(
            ConversationMessage.conversation_id == conversation.id,
            ConversationMessage.sender_id != user.id,
            ConversationMessage.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await session.commit()
    messages = await session.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.conversation_id == conversation.id)
        .order_by(ConversationMessage.created_at.desc(), ConversationMessage.id.desc())
        .limit(200)
    )
    return [MessageRead.model_validate(message) for message in reversed(list(messages))]


@router.post(
    "/me/conversations/{conversation_id}/messages",
    response_model=MessageRead,
    status_code=201,
)
async def send_message(
    conversation_id: UUID,
    payload: MessageCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessageRead:
    conversation, shop = await _conversation(session, user, conversation_id)
    recipient_id = (
        shop.owner_user_id if conversation.customer_id == user.id else conversation.customer_id
    )
    message = ConversationMessage(
        conversation_id=conversation.id,
        sender_id=user.id,
        content=payload.content,
    )
    session.add(message)
    conversation.updated_at = datetime.now(timezone.utc)
    session.add(
        OrderNotification(
            user_id=recipient_id,
            order_id=conversation.order_id,
            conversation_id=conversation.id,
            title=f"New message from {user.profile.full_name if user.profile else 'a participant'}",
            message=payload.content[:500],
        )
    )
    await session.commit()
    await session.refresh(message)
    response = MessageRead.model_validate(message)
    await connections.publish(conversation.id, response)
    return response


@router.websocket("/communications/ws/{conversation_id}")
async def conversation_socket(websocket: WebSocket, conversation_id: UUID) -> None:
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in get_settings().cors_origins:
        await websocket.close(code=4403)
        return
    token = websocket.cookies.get("vmarket_session")
    if not token:
        await websocket.close(code=4401)
        return
    async with get_session_factory()() as session:
        auth_session = await session.scalar(
            select(AuthSession).where(
                AuthSession.token_hash == hash_token(token),
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.now(timezone.utc),
            )
        )
        user = await session.get(User, auth_session.user_id) if auth_session is not None else None
        conversation = await session.get(Conversation, conversation_id)
        shop = await session.get(Shop, conversation.shop_id) if conversation is not None else None
        if (
            user is None
            or user.account_status != "active"
            or not user.email_verified
            or conversation is None
            or shop is None
            or user.id not in {conversation.customer_id, shop.owner_user_id}
        ):
            await websocket.close(code=4403)
            return
    await websocket.accept()
    await connections.connect(conversation_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await connections.disconnect(conversation_id, websocket)


@router.get("/catalog/products/{product_id}/reviews", response_model=list[ReviewRead])
async def list_product_reviews(
    product_id: UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ReviewRead]:
    product = await session.scalar(
        select(Product).where(Product.id == product_id, Product.status == "approved")
    )
    if product is None:
        raise APIError(404, "product_not_found", "The product was not found.")
    reviews = await session.scalars(
        select(ProductReview)
        .where(
            ProductReview.product_id == product_id,
            ProductReview.moderation_status == "visible",
        )
        .order_by(ProductReview.created_at.desc())
        .limit(100)
    )
    return [await _review_read(session, review) for review in reviews]


@router.post("/me/reviews", response_model=ReviewRead, status_code=201)
async def create_review(
    payload: ReviewCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReviewRead:
    result = await session.execute(
        select(OrderItem, FulfillmentOrder, CustomerOrder)
        .join(FulfillmentOrder, FulfillmentOrder.id == OrderItem.fulfillment_order_id)
        .join(CustomerOrder, CustomerOrder.id == FulfillmentOrder.order_id)
        .where(
            OrderItem.id == payload.order_item_id,
            CustomerOrder.customer_id == user.id,
            FulfillmentOrder.status == "delivered",
            OrderItem.product_id.is_not(None),
        )
    )
    row = result.first()
    if row is None:
        raise APIError(
            403,
            "review_not_eligible",
            "Reviews are available only for products in delivered orders you purchased.",
        )
    item, _, _ = row
    existing = await session.scalar(
        select(ProductReview).where(ProductReview.order_item_id == item.id)
    )
    if existing is not None:
        raise APIError(409, "review_already_exists", "This purchase has already been reviewed.")
    review = ProductReview(
        product_id=item.product_id,
        order_item_id=item.id,
        customer_id=user.id,
        rating=payload.rating,
        title=payload.title,
        body=payload.body,
        moderation_status="pending",
    )
    session.add(review)
    await session.commit()
    await session.refresh(review)
    return await _review_read(session, review)


@router.post(
    "/me/reviews/{review_id}/reports",
    response_model=ReviewReportRead,
    status_code=201,
)
async def report_review(
    review_id: UUID,
    payload: ReviewReportCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReviewReportRead:
    review = await session.get(ProductReview, review_id)
    if review is None or review.customer_id == user.id:
        raise APIError(404, "review_not_found", "The review was not found.")
    existing = await session.scalar(
        select(ReviewReport).where(
            ReviewReport.review_id == review_id,
            ReviewReport.reporter_id == user.id,
        )
    )
    if existing is not None:
        raise APIError(409, "review_already_reported", "You have already reported this review.")
    report = ReviewReport(
        review_id=review_id,
        reporter_id=user.id,
        reason=payload.reason,
        details=payload.details,
    )
    session.add(report)
    await session.commit()
    await session.refresh(report)
    return await _review_report_read(session, report)


@router.get("/vendor/reviews", response_model=list[ReviewRead])
async def list_vendor_reviews(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[ReviewRead]:
    shop = await session.scalar(select(Shop).where(Shop.owner_user_id == user.id))
    if shop is None:
        raise APIError(404, "shop_not_found", "The vendor shop was not found.")
    reviews = await session.scalars(
        select(ProductReview)
        .join(Product, Product.id == ProductReview.product_id)
        .where(Product.shop_id == shop.id, ProductReview.moderation_status == "visible")
        .order_by(ProductReview.created_at.desc())
        .limit(100)
    )
    return [await _review_read(session, review) for review in reviews]


@router.post("/vendor/reviews/{review_id}/response", response_model=ReviewRead)
async def respond_to_review(
    review_id: UUID,
    payload: VendorReviewResponse,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReviewRead:
    review = await session.scalar(
        select(ProductReview)
        .join(Product, Product.id == ProductReview.product_id)
        .join(Shop, Shop.id == Product.shop_id)
        .where(
            ProductReview.id == review_id,
            ProductReview.moderation_status == "visible",
            Shop.owner_user_id == user.id,
        )
    )
    if review is None:
        raise APIError(404, "review_not_found", "The review was not found for your shop.")
    review.vendor_response = payload.response
    review.vendor_responded_at = datetime.now(timezone.utc)
    session.add(
        OrderNotification(
            user_id=review.customer_id,
            title="A vendor responded to your review",
            message=f"{review.product_id}: {payload.response[:400]}",
        )
    )
    await session.commit()
    await session.refresh(review)
    return await _review_read(session, review)


@router.get("/admin/review-reports", response_model=list[ReviewReportRead])
async def list_review_reports(
    _: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: Annotated[str, Query(pattern="^(pending|resolved|rejected)$")] = "pending",
) -> list[ReviewReportRead]:
    reports = await session.scalars(
        select(ReviewReport)
        .where(ReviewReport.status == status)
        .order_by(ReviewReport.created_at.asc())
        .limit(100)
    )
    return [await _review_report_read(session, report) for report in reports]


@router.get("/admin/reviews", response_model=list[ReviewRead])
async def list_reviews_for_moderation(
    _: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: Annotated[str, Query(pattern="^(pending|visible|hidden)$")] = "pending",
) -> list[ReviewRead]:
    reviews = await session.scalars(
        select(ProductReview)
        .where(ProductReview.moderation_status == status)
        .order_by(ProductReview.created_at.asc())
        .limit(100)
    )
    return [await _review_read(session, review) for review in reviews]


@router.patch("/admin/reviews/{review_id}/moderation", response_model=ReviewRead)
async def moderate_review(
    review_id: UUID,
    payload: ReviewModerationUpdate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReviewRead:
    review = await session.get(ProductReview, review_id)
    if review is None:
        raise APIError(404, "review_not_found", "The review was not found.")
    previous_status = review.moderation_status
    if payload.status is not None:
        review.moderation_status = payload.status
    review.moderated_by_id = admin.id
    review.moderated_at = datetime.now(timezone.utc)
    session.add(
        AuditLog(
            actor_id=admin.id,
            action="review_moderated",
            target_type="product_review",
            target_id=str(review.id),
            details=f"{previous_status} -> {review.moderation_status}",
        )
    )
    reports = await session.scalars(
        select(ReviewReport).where(
            ReviewReport.review_id == review.id,
            ReviewReport.status == "pending",
        )
    )
    for report in reports:
        report.status = payload.report_status or "resolved"
        report.resolved_by_id = admin.id
        report.resolved_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(review)
    return await _review_read(session, review)


@router.post("/me/support-tickets", response_model=SupportTicketRead, status_code=201)
async def create_support_ticket(
    payload: SupportTicketCreate,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SupportTicketRead:
    if payload.kind == "dispute" and payload.order_id is None:
        raise APIError(422, "dispute_order_required", "A dispute must reference an order.")
    if payload.order_id is not None:
        await _ticket_order_access(session, user, payload.order_id)
    ticket = SupportTicket(
        created_by_id=user.id,
        order_id=payload.order_id,
        kind=payload.kind,
        subject=payload.subject,
        body=payload.body,
    )
    session.add(ticket)
    await session.flush()
    admin_ids = await session.scalars(select(UserRole.user_id).where(UserRole.role == "admin"))
    for admin_id in admin_ids:
        session.add(
            OrderNotification(
                user_id=admin_id,
                order_id=payload.order_id,
                title="New support dispute" if payload.kind == "dispute" else "New support ticket",
                message=payload.subject,
            )
        )
    await session.commit()
    await session.refresh(ticket)
    return SupportTicketRead.model_validate(ticket)


@router.get("/me/support-tickets", response_model=list[SupportTicketRead])
async def list_my_support_tickets(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[SupportTicketRead]:
    tickets = await session.scalars(
        select(SupportTicket)
        .where(SupportTicket.created_by_id == user.id)
        .order_by(SupportTicket.updated_at.desc())
        .limit(100)
    )
    return [SupportTicketRead.model_validate(ticket) for ticket in tickets]


@router.get("/admin/support-tickets", response_model=list[SupportTicketRead])
async def list_support_tickets(
    _: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: Annotated[str | None, Query(pattern="^(open|in_progress|resolved|closed)$")] = None,
) -> list[SupportTicketRead]:
    query = select(SupportTicket).order_by(SupportTicket.updated_at.asc()).limit(100)
    if status is not None:
        query = query.where(SupportTicket.status == status)
    tickets = await session.scalars(query)
    return [SupportTicketRead.model_validate(ticket) for ticket in tickets]


@router.patch("/admin/support-tickets/{ticket_id}", response_model=SupportTicketRead)
async def update_support_ticket(
    ticket_id: UUID,
    payload: SupportTicketUpdate,
    admin: Annotated[User, Depends(get_current_admin)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SupportTicketRead:
    ticket = await session.get(SupportTicket, ticket_id)
    if ticket is None:
        raise APIError(404, "support_ticket_not_found", "The support ticket was not found.")
    previous_status = ticket.status
    ticket.status = payload.status
    ticket.admin_response = payload.admin_response
    ticket.assigned_admin_id = admin.id
    session.add(
        OrderNotification(
            user_id=ticket.created_by_id,
            order_id=ticket.order_id,
            title="Support request updated",
            message=f"{ticket.subject}: {payload.status.replace('_', ' ')}",
        )
    )
    session.add(
        AuditLog(
            actor_id=admin.id,
            action="support_ticket_updated",
            target_type="support_ticket",
            target_id=str(ticket.id),
            details=f"{previous_status} -> {payload.status}",
        )
    )
    await session.commit()
    await session.refresh(ticket)
    return SupportTicketRead.model_validate(ticket)
