from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Response
from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog.models import Product, ProductImage, ProductVariant, Shop
from app.catalog.urls import public_object_url
from app.core.errors import APIError
from app.db.session import get_session
from app.identity.dependencies import (
    WorkspaceContext,
    get_current_customer,
    get_current_vendor,
    get_selected_shop,
    get_workspace_context,
)
from app.identity.models import DeliveryAddress, User
from app.operations.models import PlatformSettings, Promotion
from app.orders.models import (
    CartItem,
    CustomerOrder,
    DeliveryFeedback,
    FulfillmentOrder,
    OrderItem,
    OrderNotification,
    OrderStatusEvent,
    PaymentTransaction,
)
from app.orders.schemas import (
    CartItemCreate,
    CartItemQuantity,
    CartItemRead,
    CartRead,
    CheckoutCreate,
    DeliveryFeedbackCreate,
    DeliveryFeedbackRead,
    FulfillmentOrderRead,
    FulfillmentStatusUpdate,
    InvoiceRead,
    NotificationBatchUpdate,
    NotificationRead,
    OrderEventRead,
    OrderItemRead,
    OrderRead,
    PaymentTransactionRead,
    VendorFulfillmentPage,
)

router = APIRouter(tags=["orders"])
SHIPPING_FEE_PER_VENDOR = Decimal("100.00")
MONEY = Decimal("0.01")


async def _cart_item_read(session: AsyncSession, item: CartItem) -> CartItemRead:
    product = await session.get(Product, item.product_id)
    if product is None:
        raise APIError(
            409, "cart_item_unavailable", "A product in your cart is no longer available."
        )
    shop = await session.get(Shop, product.shop_id)
    if shop is None:
        raise APIError(409, "cart_item_unavailable", "A shop in your cart is no longer available.")
    variant = await session.get(ProductVariant, item.variant_id) if item.variant_id else None
    if item.variant_id is not None and (variant is None or variant.product_id != product.id):
        raise APIError(
            409, "cart_item_unavailable", "A product option in your cart is no longer available."
        )
    price = variant.price if variant else product.price
    stock = variant.stock if variant else product.stock
    image = await session.scalar(
        select(ProductImage)
        .where(ProductImage.product_id == product.id)
        .order_by(ProductImage.sort_order, ProductImage.created_at)
        .limit(1)
    )
    return CartItemRead(
        id=item.id,
        product_id=product.id,
        variant_id=variant.id if variant else None,
        product_name=product.name,
        product_slug=product.slug,
        variant_name=variant.name if variant else None,
        sku=variant.sku if variant else product.sku,
        image_url=public_object_url(image.object_name) if image else None,
        image_alt=(image.alt_text or product.name) if image else product.name,
        shop_id=shop.id,
        shop_name=shop.name,
        unit_price=price,
        quantity=item.quantity,
        available_stock=stock,
        line_total=price * item.quantity,
    )


async def _cart_read(session: AsyncSession, user_id: UUID) -> CartRead:
    items = list(
        await session.scalars(
            select(CartItem)
            .where(CartItem.user_id == user_id)
            .order_by(CartItem.created_at, CartItem.id)
        )
    )
    reads = [await _cart_item_read(session, item) for item in items]
    return CartRead(
        items=reads,
        item_count=sum(item.quantity for item in reads),
        subtotal=sum((item.line_total for item in reads), Decimal("0.00")),
    )


async def _cart_item_for_user(session: AsyncSession, user: User, cart_item_id: UUID) -> CartItem:
    item = await session.scalar(
        select(CartItem).where(CartItem.id == cart_item_id, CartItem.user_id == user.id)
    )
    if item is None:
        raise APIError(404, "cart_item_not_found", "The cart item was not found.")
    return item


async def _lock_user_cart(session: AsyncSession, user: User) -> None:
    await session.scalar(select(User.id).where(User.id == user.id).with_for_update())


async def _order_read(session: AsyncSession, order: CustomerOrder) -> OrderRead:
    promotion = await session.get(Promotion, order.promotion_id) if order.promotion_id else None
    fulfillment_orders = list(
        await session.scalars(
            select(FulfillmentOrder)
            .where(FulfillmentOrder.order_id == order.id)
            .order_by(FulfillmentOrder.created_at, FulfillmentOrder.id)
        )
    )
    fulfillment_reads = [await _fulfillment_read(session, item) for item in fulfillment_orders]
    return OrderRead(
        id=order.id,
        order_number=order.order_number,
        invoice_number=order.invoice_number,
        status=order.status,
        payment_method=order.payment_method,
        shipping_address=order.shipping_address,
        subtotal=order.subtotal,
        shipping_total=order.shipping_total,
        discount_total=order.discount_total,
        promotion_code=promotion.code if promotion else None,
        total=order.total,
        created_at=order.created_at,
        updated_at=order.updated_at,
        fulfillments=fulfillment_reads,
    )


async def _return_deadline(session: AsyncSession, fulfillment_id: UUID) -> datetime | None:
    delivered_at = await session.scalar(
        select(OrderStatusEvent.created_at)
        .where(
            OrderStatusEvent.fulfillment_order_id == fulfillment_id,
            OrderStatusEvent.to_status == "delivered",
        )
        .order_by(OrderStatusEvent.created_at.desc())
        .limit(1)
    )
    if delivered_at is None:
        return None
    if delivered_at.tzinfo is None:
        delivered_at = delivered_at.replace(tzinfo=timezone.utc)
    settings = await session.get(PlatformSettings, 1)
    if settings is None:
        raise APIError(
            503,
            "platform_settings_unavailable",
            "Platform settings are unavailable. Apply the latest database migration.",
        )
    return delivered_at + timedelta(days=settings.return_window_days)


async def _fulfillment_read(
    session: AsyncSession, fulfillment: FulfillmentOrder
) -> FulfillmentOrderRead:
    order = await session.get(CustomerOrder, fulfillment.order_id)
    if order is None:
        raise APIError(409, "order_unavailable", "The fulfillment's order is unavailable.")
    items = list(
        await session.scalars(
            select(OrderItem)
            .where(OrderItem.fulfillment_order_id == fulfillment.id)
            .order_by(OrderItem.created_at, OrderItem.id)
        )
    )
    events = list(
        await session.scalars(
            select(OrderStatusEvent)
            .where(OrderStatusEvent.fulfillment_order_id == fulfillment.id)
            .order_by(OrderStatusEvent.created_at, OrderStatusEvent.id)
        )
    )
    transactions = list(
        await session.scalars(
            select(PaymentTransaction)
            .where(PaymentTransaction.fulfillment_order_id == fulfillment.id)
            .order_by(PaymentTransaction.created_at, PaymentTransaction.id)
        )
    )
    product_ids = {item.product_id for item in items if item.product_id is not None}
    images: dict[UUID, ProductImage] = {}
    if product_ids:
        for image in await session.scalars(
            select(ProductImage)
            .where(ProductImage.product_id.in_(product_ids))
            .order_by(
                ProductImage.product_id,
                ProductImage.sort_order,
                ProductImage.created_at,
                ProductImage.id,
            )
        ):
            images.setdefault(image.product_id, image)
    item_reads = []
    for item in items:
        read = OrderItemRead.model_validate(item)
        primary_image = images.get(item.product_id) if item.product_id else None
        read.image_url = public_object_url(primary_image.object_name) if primary_image else None
        read.image_alt = (
            (primary_image.alt_text or item.product_name) if primary_image else item.product_name
        )
        item_reads.append(read)
    feedback = await session.get(DeliveryFeedback, fulfillment.id)
    deadline = (
        await _return_deadline(session, fulfillment.id)
        if fulfillment.status == "delivered"
        else None
    )
    return FulfillmentOrderRead(
        id=fulfillment.id,
        order_id=fulfillment.order_id,
        fulfillment_number=fulfillment.fulfillment_number,
        shop_id=fulfillment.shop_id,
        shop_name=fulfillment.shop_name,
        status=fulfillment.status,
        subtotal=fulfillment.subtotal,
        shipping_fee=fulfillment.shipping_fee,
        discount_total=fulfillment.discount_total,
        commission_rate_bps=fulfillment.commission_rate_bps,
        commission_amount=fulfillment.commission_amount,
        tracking_number=fulfillment.tracking_number,
        courier_name=fulfillment.courier_name,
        support_phone=fulfillment.support_phone,
        support_email=fulfillment.support_email,
        delivery_feedback=DeliveryFeedbackRead.model_validate(feedback) if feedback else None,
        return_deadline=deadline,
        can_request_return=deadline is not None and deadline >= datetime.now(timezone.utc),
        shipping_address={
            key: order.shipping_address.get(key)
            for key in (
                "recipient_name",
                "phone",
                "province",
                "city",
                "area",
                "street_address",
                "postal_code",
            )
        },
        created_at=fulfillment.created_at,
        updated_at=fulfillment.updated_at,
        items=item_reads,
        events=[OrderEventRead.model_validate(item) for item in events],
        transactions=[PaymentTransactionRead.model_validate(item) for item in transactions],
    )


def _notify(
    session: AsyncSession,
    *,
    user_id: UUID,
    order_id: UUID,
    fulfillment_id: UUID | None,
    title: str,
    message: str,
    workspace: str = "customer",
    shop_id: UUID | None = None,
) -> None:
    session.add(
        OrderNotification(
            user_id=user_id,
            order_id=order_id,
            fulfillment_order_id=fulfillment_id,
            title=title,
            message=message,
            workspace=workspace,
            shop_id=shop_id,
        )
    )


async def _notify_shop_owner(
    session: AsyncSession,
    fulfillment: FulfillmentOrder,
    *,
    title: str,
    message: str,
) -> None:
    if fulfillment.shop_id is None:
        return
    shop = await session.get(Shop, fulfillment.shop_id)
    if shop is None:
        return
    _notify(
        session,
        user_id=shop.owner_user_id,
        order_id=fulfillment.order_id,
        fulfillment_id=fulfillment.id,
        title=title,
        message=message,
        workspace="vendor",
        shop_id=shop.id,
    )


async def _customer_order(session: AsyncSession, user: User, order_id: UUID) -> CustomerOrder:
    order = await session.scalar(
        select(CustomerOrder).where(
            CustomerOrder.id == order_id,
            CustomerOrder.customer_id == user.id,
        )
    )
    if order is None:
        raise APIError(404, "order_not_found", "The order was not found.")
    return order


async def _vendor_fulfillment(
    session: AsyncSession, shop: Shop, fulfillment_id: UUID
) -> FulfillmentOrder:
    fulfillment = await session.scalar(
        select(FulfillmentOrder)
        .where(
            FulfillmentOrder.id == fulfillment_id,
            FulfillmentOrder.shop_id == shop.id,
        )
        .with_for_update()
    )
    if fulfillment is None:
        raise APIError(404, "fulfillment_not_found", "The fulfillment order was not found.")
    return fulfillment


async def _restock_fulfillment(session: AsyncSession, fulfillment_id: UUID) -> None:
    items = await session.scalars(
        select(OrderItem)
        .where(OrderItem.fulfillment_order_id == fulfillment_id)
        .order_by(OrderItem.product_id, OrderItem.variant_id)
    )
    for item in items:
        if item.inventory_variant:
            if item.variant_id is not None:
                variant = await session.scalar(
                    select(ProductVariant)
                    .where(ProductVariant.id == item.variant_id)
                    .with_for_update()
                )
                if variant is not None:
                    variant.stock += item.quantity
        elif item.product_id is not None:
            product = await session.scalar(
                select(Product).where(Product.id == item.product_id).with_for_update()
            )
            if product is not None:
                product.stock += item.quantity


async def _recalculate_order_status(session: AsyncSession, order_id: UUID) -> None:
    order = await session.scalar(
        select(CustomerOrder).where(CustomerOrder.id == order_id).with_for_update()
    )
    if order is None:
        return
    statuses = list(
        await session.scalars(
            select(FulfillmentOrder.status).where(FulfillmentOrder.order_id == order_id)
        )
    )
    if not statuses:
        return
    if all(status == "cancelled" for status in statuses):
        order.status = "cancelled"
    elif all(status == "returned" for status in statuses):
        order.status = "returned"
    elif "return_requested" in statuses:
        order.status = "return_requested"
    elif all(status in {"delivered", "returned"} for status in statuses):
        order.status = "completed"
    elif "cancelled" in statuses:
        order.status = "partially_cancelled"
    elif all(status == "pending" for status in statuses):
        order.status = "pending"
    else:
        order.status = "in_progress"


async def _record_status_change(
    session: AsyncSession,
    *,
    fulfillment: FulfillmentOrder,
    actor_id: UUID,
    next_status: str,
    note: str | None,
) -> None:
    previous_status = fulfillment.status
    fulfillment.status = next_status
    session.add(
        OrderStatusEvent(
            order_id=fulfillment.order_id,
            fulfillment_order_id=fulfillment.id,
            actor_id=actor_id,
            from_status=previous_status,
            to_status=next_status,
            note=note,
            created_at=datetime.now(timezone.utc),
        )
    )
    order = await session.get(CustomerOrder, fulfillment.order_id)
    if order is not None:
        _notify(
            session,
            user_id=order.customer_id,
            order_id=order.id,
            fulfillment_id=fulfillment.id,
            title=f"Order {next_status.replace('_', ' ').title()}",
            message=(
                f"{fulfillment.shop_name} updated fulfillment "
                f"{fulfillment.fulfillment_number} to {next_status.replace('_', ' ')}."
            ),
        )
    await _recalculate_order_status(session, fulfillment.order_id)


@router.get("/me/cart", response_model=CartRead)
async def get_cart(
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CartRead:
    return await _cart_read(session, user.id)


@router.post("/me/cart/items", response_model=CartRead, status_code=201)
async def add_cart_item(
    body: CartItemCreate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CartRead:
    await _lock_user_cart(session, user)
    product = await session.get(Product, body.product_id)
    if product is None or product.status != "approved":
        raise APIError(404, "product_unavailable", "This product is not available for purchase.")
    shop = await session.get(Shop, product.shop_id)
    if shop is None or not shop.is_active:
        raise APIError(404, "product_unavailable", "This product is not available for purchase.")
    if shop.owner_user_id == user.id:
        raise APIError(403, "own_shop_purchase_forbidden", "You cannot buy from your own shops.")
    has_variants = await session.scalar(
        select(ProductVariant.id).where(ProductVariant.product_id == product.id).limit(1)
    )
    if has_variants is not None and body.variant_id is None:
        raise APIError(
            422, "variant_required", "Choose a product option before adding it to your cart."
        )
    variant: ProductVariant | None = None
    if body.variant_id is not None:
        variant = await session.get(ProductVariant, body.variant_id)
        if variant is None or variant.product_id != product.id:
            raise APIError(404, "variant_not_found", "The selected product option was not found.")
    stock = variant.stock if variant else product.stock
    existing = await session.scalar(
        select(CartItem).where(
            CartItem.user_id == user.id,
            CartItem.product_id == product.id,
            CartItem.variant_id == body.variant_id
            if body.variant_id is not None
            else CartItem.variant_id.is_(None),
        )
    )
    quantity = body.quantity + (existing.quantity if existing is not None else 0)
    if quantity > stock:
        raise APIError(409, "insufficient_stock", "The requested quantity exceeds available stock.")
    if existing is None:
        session.add(
            CartItem(
                user_id=user.id,
                product_id=product.id,
                variant_id=body.variant_id,
                quantity=body.quantity,
            )
        )
    else:
        existing.quantity = quantity
    await session.commit()
    return await _cart_read(session, user.id)


@router.patch("/me/cart/items/{cart_item_id}", response_model=CartRead)
async def update_cart_item(
    cart_item_id: UUID,
    body: CartItemQuantity,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CartRead:
    await _lock_user_cart(session, user)
    item = await _cart_item_for_user(session, user, cart_item_id)
    product = await session.get(Product, item.product_id)
    shop = await session.get(Shop, product.shop_id) if product is not None else None
    if shop is not None and shop.owner_user_id == user.id:
        raise APIError(403, "own_shop_purchase_forbidden", "You cannot buy from your own shops.")
    variant = await session.get(ProductVariant, item.variant_id) if item.variant_id else None
    stock = variant.stock if variant else product.stock if product is not None else 0
    if body.quantity > stock:
        raise APIError(409, "insufficient_stock", "The requested quantity exceeds available stock.")
    item.quantity = body.quantity
    await session.commit()
    return await _cart_read(session, user.id)


@router.delete("/me/cart/items/{cart_item_id}", status_code=204)
async def delete_cart_item(
    cart_item_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    await _lock_user_cart(session, user)
    item = await _cart_item_for_user(session, user, cart_item_id)
    await session.delete(item)
    await session.commit()
    return Response(status_code=204)


@router.post("/me/checkout", response_model=OrderRead, status_code=201)
async def checkout(
    body: CheckoutCreate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderRead:
    await _lock_user_cart(session, user)
    existing_order = await session.scalar(
        select(CustomerOrder).where(
            CustomerOrder.customer_id == user.id,
            CustomerOrder.idempotency_key == body.idempotency_key,
        )
    )
    if existing_order is not None:
        existing_promotion = (
            await session.get(Promotion, existing_order.promotion_id)
            if existing_order.promotion_id
            else None
        )
        if (
            existing_order.address_id != body.address_id
            or existing_order.payment_method != body.payment_method
            or (existing_promotion.code if existing_promotion else None) != body.promotion_code
        ):
            raise APIError(
                409, "idempotency_key_reused", "Use a new checkout key for a different order."
            )
        return await _order_read(session, existing_order)

    address = await session.scalar(
        select(DeliveryAddress).where(
            DeliveryAddress.id == body.address_id,
            DeliveryAddress.user_id == user.id,
        )
    )
    if address is None:
        raise APIError(
            422, "invalid_delivery_address", "Choose one of your saved delivery addresses."
        )
    if not all(
        value and value.strip()
        for value in (
            address.recipient_name,
            address.phone,
            address.province,
            address.city,
            address.street_address,
        )
    ):
        raise APIError(
            422,
            "invalid_delivery_address",
            "The selected address is missing required delivery details.",
        )
    cart_items = list(
        await session.scalars(
            select(CartItem)
            .where(CartItem.user_id == user.id)
            .order_by(CartItem.product_id, CartItem.variant_id, CartItem.id)
        )
    )
    if not cart_items:
        raise APIError(409, "cart_empty", "Add at least one product before placing an order.")

    settings = await session.scalar(
        select(PlatformSettings).where(PlatformSettings.id == 1).with_for_update()
    )
    if settings is None:
        raise APIError(
            503,
            "platform_settings_unavailable",
            "Platform settings are unavailable. Apply the latest database migration.",
        )
    promotion: Promotion | None = None
    if body.promotion_code:
        promotion = await session.scalar(
            select(Promotion).where(Promotion.code == body.promotion_code).with_for_update()
        )
        now = datetime.now(timezone.utc)
        if promotion is None or not promotion.is_active:
            raise APIError(422, "promotion_unavailable", "This promotion code is not available.")
        starts_at = promotion.starts_at
        ends_at = promotion.ends_at
        if starts_at is not None and starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=timezone.utc)
        if ends_at is not None and ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
        if (
            (starts_at is not None and starts_at > now)
            or (ends_at is not None and ends_at <= now)
            or (
                promotion.max_redemptions is not None
                and promotion.redemption_count >= promotion.max_redemptions
            )
        ):
            raise APIError(422, "promotion_unavailable", "This promotion code is not available.")

    validated: list[tuple[CartItem, Product, ProductVariant | None, Shop, Decimal]] = []
    reserved_by_inventory: dict[tuple[str, UUID], int] = defaultdict(int)
    for item in cart_items:
        product = await session.scalar(
            select(Product).where(Product.id == item.product_id).with_for_update()
        )
        if product is None or product.status != "approved":
            raise APIError(
                409, "product_unavailable", "A product in your cart is no longer available."
            )
        shop = await session.scalar(
            select(Shop).where(Shop.id == product.shop_id).with_for_update()
        )
        if shop is not None and shop.owner_user_id == user.id:
            raise APIError(
                403, "own_shop_purchase_forbidden", "You cannot buy from your own shops."
            )
        if shop is None or not shop.is_active:
            raise APIError(409, "shop_unavailable", "A shop in your cart is no longer available.")
        variant: ProductVariant | None = None
        if item.variant_id is not None:
            variant = await session.scalar(
                select(ProductVariant)
                .where(
                    ProductVariant.id == item.variant_id,
                    ProductVariant.product_id == product.id,
                )
                .with_for_update()
            )
            if variant is None:
                raise APIError(
                    409, "variant_unavailable", "A product option in your cart is unavailable."
                )
        elif (
            await session.scalar(
                select(ProductVariant.id).where(ProductVariant.product_id == product.id).limit(1)
            )
            is not None
        ):
            raise APIError(
                409, "variant_unavailable", "Choose an option for a product in your cart."
            )
        stock = variant.stock if variant else product.stock
        inventory_key = ("variant", variant.id) if variant else ("product", product.id)
        if reserved_by_inventory[inventory_key] + item.quantity > stock:
            raise APIError(
                409,
                "insufficient_stock",
                f"Only {stock} unit(s) of {product.name} are available.",
            )
        reserved_by_inventory[inventory_key] += item.quantity
        validated.append(
            (item, product, variant, shop, variant.price if variant else product.price)
        )

    grouped: dict[UUID, list[tuple[CartItem, Product, ProductVariant | None, Shop, Decimal]]] = (
        defaultdict(list)
    )
    for entry in validated:
        grouped[entry[3].id].append(entry)

    subtotal_by_shop = {
        shop_id: sum(
            (price * item.quantity for item, _, _, _, price in entries),
            Decimal("0.00"),
        )
        for shop_id, entries in grouped.items()
    }
    gross_subtotal = sum(subtotal_by_shop.values(), Decimal("0.00"))
    eligible_subtotal = gross_subtotal
    if promotion is not None and promotion.shop_id is not None:
        eligible_subtotal = subtotal_by_shop.get(promotion.shop_id, Decimal("0.00"))
        if eligible_subtotal <= 0:
            raise APIError(
                422,
                "promotion_shop_not_in_cart",
                "This vendor promotion applies only to items from its shop.",
            )
    discount_total = Decimal("0.00")
    if promotion is not None:
        if promotion.discount_type == "percent":
            discount_total = (
                eligible_subtotal * promotion.discount_value / Decimal("100")
            ).quantize(MONEY, rounding=ROUND_HALF_UP)
        else:
            discount_total = min(promotion.discount_value, eligible_subtotal).quantize(
                MONEY, rounding=ROUND_HALF_UP
            )

    discounts_by_shop: dict[UUID, Decimal] = {}
    eligible_shops = (
        [promotion.shop_id]
        if promotion is not None and promotion.shop_id is not None
        else list(grouped)
    )
    remaining_discount = discount_total
    for shop_id in eligible_shops:
        eligible_amount = subtotal_by_shop[shop_id]
        if shop_id == eligible_shops[-1]:
            shop_discount = remaining_discount
        else:
            shop_discount = (discount_total * eligible_amount / eligible_subtotal).quantize(
                MONEY, rounding=ROUND_HALF_UP
            )
            shop_discount = min(shop_discount, remaining_discount)
        discounts_by_shop[shop_id] = shop_discount
        remaining_discount -= shop_discount

    order_number = f"VM-{datetime.now(timezone.utc):%Y%m%d}-{uuid4().hex[:10].upper()}"
    order = CustomerOrder(
        customer_id=user.id,
        order_number=order_number,
        invoice_number=f"INV-{order_number}",
        idempotency_key=body.idempotency_key,
        promotion_id=promotion.id if promotion else None,
        address_id=address.id,
        shipping_address={
            "label": address.label,
            "recipient_name": address.recipient_name,
            "phone": address.phone,
            "province": address.province,
            "city": address.city,
            "area": address.area,
            "street_address": address.street_address,
            "postal_code": address.postal_code,
        },
        status="pending",
        payment_method=body.payment_method,
        subtotal=gross_subtotal,
        shipping_total=Decimal("0.00"),
        discount_total=discount_total,
        total=Decimal("0.00"),
    )
    session.add(order)
    await session.flush()
    _notify(
        session,
        user_id=user.id,
        order_id=order.id,
        fulfillment_id=None,
        title="Order placed",
        message=f"Order {order.order_number} is confirmed and awaiting vendor acceptance.",
    )

    subtotal = Decimal("0.00")
    shipping_total = Decimal("0.00")
    for shop_id, shop_entries in grouped.items():
        shop = shop_entries[0][3]
        fulfillment_subtotal = Decimal("0.00")
        fulfillment_discount = discounts_by_shop.get(shop_id, Decimal("0.00"))
        fulfillment = FulfillmentOrder(
            order_id=order.id,
            shop_id=shop_id,
            shop_name=shop.name,
            fulfillment_number=f"FUL-{uuid4().hex[:12].upper()}",
            status="pending",
            subtotal=subtotal_by_shop[shop_id],
            shipping_fee=SHIPPING_FEE_PER_VENDOR,
            discount_total=fulfillment_discount,
            commission_rate_bps=settings.commission_rate_bps,
            commission_amount=Decimal("0.00"),
        )
        session.add(fulfillment)
        await session.flush()
        for item, product, variant, _, price in shop_entries:
            line_total = price * item.quantity
            fulfillment_subtotal += line_total
            if variant is not None:
                variant.stock -= item.quantity
            else:
                product.stock -= item.quantity
            session.add(
                OrderItem(
                    fulfillment_order_id=fulfillment.id,
                    product_id=product.id,
                    variant_id=variant.id if variant else None,
                    inventory_variant=variant is not None,
                    product_name=product.name,
                    variant_name=variant.name if variant else None,
                    sku=variant.sku if variant else product.sku,
                    quantity=item.quantity,
                    unit_price=price,
                    line_total=line_total,
                )
            )
            session.add(
                OrderStatusEvent(
                    order_id=order.id,
                    fulfillment_order_id=fulfillment.id,
                    actor_id=user.id,
                    from_status=None,
                    to_status="pending",
                    note="Order placed.",
                )
            )
            owner_id = shop.owner_user_id
            _notify(
                session,
                user_id=owner_id,
                order_id=order.id,
                fulfillment_id=fulfillment.id,
                title="New fulfillment order",
                message=f"Order {order.order_number} is ready for {shop.name} to review.",
                workspace="vendor",
                shop_id=shop.id,
            )
        fulfillment.subtotal = fulfillment_subtotal
        commission_base = fulfillment_subtotal - (
            fulfillment_discount
            if promotion and promotion.sponsor_type == "vendor"
            else Decimal("0.00")
        )
        fulfillment.commission_amount = (
            commission_base * Decimal(settings.commission_rate_bps) / Decimal("10000")
        ).quantize(MONEY, rounding=ROUND_HALF_UP)
        session.add(
            PaymentTransaction(
                order_id=order.id,
                fulfillment_order_id=fulfillment.id,
                transaction_type="charge",
                method="cash_on_delivery",
                status="pending",
                amount=fulfillment_subtotal + SHIPPING_FEE_PER_VENDOR - fulfillment_discount,
            )
        )
        subtotal += fulfillment_subtotal
        shipping_total += SHIPPING_FEE_PER_VENDOR

    order.subtotal = subtotal
    order.shipping_total = shipping_total
    order.total = subtotal + shipping_total - discount_total
    if promotion is not None:
        promotion.redemption_count += 1
    for item in cart_items:
        await session.delete(item)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        duplicate = await session.scalar(
            select(CustomerOrder).where(
                CustomerOrder.customer_id == user.id,
                CustomerOrder.idempotency_key == body.idempotency_key,
            )
        )
        if duplicate is not None and duplicate.address_id == body.address_id:
            return await _order_read(session, duplicate)
        raise APIError(
            409, "checkout_conflict", "The order could not be placed. Please retry."
        ) from None
    await session.refresh(order)
    return await _order_read(session, order)


@router.get("/me/orders", response_model=list[OrderRead])
async def list_customer_orders(
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[OrderRead]:
    orders = await session.scalars(
        select(CustomerOrder)
        .where(CustomerOrder.customer_id == user.id)
        .order_by(CustomerOrder.created_at.desc())
        .limit(50)
    )
    return [await _order_read(session, order) for order in orders]


@router.get("/me/orders/{order_id}", response_model=OrderRead)
async def get_customer_order(
    order_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderRead:
    order = await _customer_order(session, user, order_id)
    return await _order_read(session, order)


@router.get("/me/orders/{order_id}/invoice", response_model=InvoiceRead)
async def get_order_invoice(
    order_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> InvoiceRead:
    order = await _customer_order(session, user, order_id)
    order_read = await _order_read(session, order)
    return InvoiceRead(
        invoice_number=order.invoice_number,
        order_number=order.order_number,
        issued_at=order.created_at,
        payment_method=order.payment_method,
        status=order.status,
        shipping_address=order.shipping_address,
        subtotal=order.subtotal,
        shipping_total=order.shipping_total,
        discount_total=order.discount_total,
        total=order.total,
        fulfillments=order_read.fulfillments,
    )


@router.post("/me/fulfillment-orders/{fulfillment_id}/cancel", response_model=OrderRead)
async def cancel_fulfillment(
    fulfillment_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderRead:
    fulfillment = await session.scalar(
        select(FulfillmentOrder).where(FulfillmentOrder.id == fulfillment_id).with_for_update()
    )
    if fulfillment is None:
        raise APIError(404, "fulfillment_not_found", "The fulfillment order was not found.")
    order = await _customer_order(session, user, fulfillment.order_id)
    if fulfillment.status not in {"pending", "confirmed", "processing"}:
        raise APIError(409, "cancellation_unavailable", "This order can no longer be cancelled.")
    await _restock_fulfillment(session, fulfillment.id)
    await _record_status_change(
        session,
        fulfillment=fulfillment,
        actor_id=user.id,
        next_status="cancelled",
        note="Cancelled by customer.",
    )
    await _notify_shop_owner(
        session,
        fulfillment,
        title="Fulfillment cancelled",
        message=f"The customer cancelled fulfillment {fulfillment.fulfillment_number}.",
    )
    transactions = await session.scalars(
        select(PaymentTransaction).where(
            PaymentTransaction.fulfillment_order_id == fulfillment.id,
            PaymentTransaction.transaction_type == "charge",
        )
    )
    for transaction in transactions:
        transaction.status = "cancelled"
        transaction.recorded_by_id = user.id
    await session.commit()
    await session.refresh(order)
    return await _order_read(session, order)


@router.post("/me/fulfillment-orders/{fulfillment_id}/returns", response_model=OrderRead)
async def request_return(
    fulfillment_id: UUID,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> OrderRead:
    fulfillment = await session.scalar(
        select(FulfillmentOrder).where(FulfillmentOrder.id == fulfillment_id).with_for_update()
    )
    if fulfillment is None:
        raise APIError(404, "fulfillment_not_found", "The fulfillment order was not found.")
    order = await _customer_order(session, user, fulfillment.order_id)
    if fulfillment.status != "delivered":
        raise APIError(409, "return_unavailable", "Only delivered items can be returned.")
    deadline = await _return_deadline(session, fulfillment.id)
    if deadline is None or deadline < datetime.now(timezone.utc):
        raise APIError(
            409,
            "return_window_expired",
            "The return window for this delivery has expired or delivery has not been recorded.",
        )
    await _record_status_change(
        session,
        fulfillment=fulfillment,
        actor_id=user.id,
        next_status="return_requested",
        note="Return requested by customer.",
    )
    await _notify_shop_owner(
        session,
        fulfillment,
        title="Return requested",
        message=(
            f"The customer requested a return for fulfillment {fulfillment.fulfillment_number}."
        ),
    )
    await session.commit()
    await session.refresh(order)
    return await _order_read(session, order)


@router.put(
    "/me/fulfillment-orders/{fulfillment_id}/delivery-feedback",
    response_model=DeliveryFeedbackRead,
)
async def save_delivery_feedback(
    fulfillment_id: UUID,
    body: DeliveryFeedbackCreate,
    user: Annotated[User, Depends(get_current_customer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> DeliveryFeedbackRead:
    fulfillment = await session.scalar(
        select(FulfillmentOrder).where(FulfillmentOrder.id == fulfillment_id).with_for_update()
    )
    if fulfillment is None:
        raise APIError(404, "fulfillment_not_found", "The fulfillment order was not found.")
    await _customer_order(session, user, fulfillment.order_id)
    delivered = await session.scalar(
        select(OrderStatusEvent.id)
        .where(
            OrderStatusEvent.fulfillment_order_id == fulfillment.id,
            OrderStatusEvent.to_status == "delivered",
        )
        .limit(1)
    )
    if delivered is None:
        raise APIError(409, "delivery_feedback_unavailable", "Rate delivery after it is completed.")
    feedback = await session.get(DeliveryFeedback, fulfillment.id)
    if feedback is None:
        feedback = DeliveryFeedback(
            fulfillment_order_id=fulfillment.id, customer_id=user.id, rating=body.rating
        )
        session.add(feedback)
    else:
        feedback.rating = body.rating
    await session.commit()
    await session.refresh(feedback)
    return DeliveryFeedbackRead.model_validate(feedback)


@router.get("/vendor/orders", response_model=VendorFulfillmentPage)
async def list_vendor_orders(
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> VendorFulfillmentPage:
    total = await session.scalar(
        select(func.count())
        .select_from(FulfillmentOrder)
        .where(FulfillmentOrder.shop_id == shop.id)
    )
    orders = await session.scalars(
        select(FulfillmentOrder)
        .where(FulfillmentOrder.shop_id == shop.id)
        .order_by(FulfillmentOrder.created_at.desc())
        .limit(100)
    )
    return VendorFulfillmentPage(
        items=[await _fulfillment_read(session, order) for order in orders],
        total=total or 0,
    )


@router.patch(
    "/vendor/fulfillment-orders/{fulfillment_id}/status", response_model=FulfillmentOrderRead
)
async def update_fulfillment_status(
    fulfillment_id: UUID,
    body: FulfillmentStatusUpdate,
    user: Annotated[User, Depends(get_current_vendor)],
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FulfillmentOrderRead:
    fulfillment = await _vendor_fulfillment(session, shop, fulfillment_id)
    transitions = {
        "pending": {"confirmed", "cancelled"},
        "confirmed": {"processing", "cancelled"},
        "processing": {"shipped", "cancelled"},
        "shipped": {"picked_up", "in_transit", "out_for_delivery", "delivered"},
        "picked_up": {"in_transit", "out_for_delivery", "delivered"},
        "in_transit": {"out_for_delivery", "delivered"},
        "out_for_delivery": {"delivered"},
        "return_requested": {"returned", "return_rejected"},
    }
    if body.status not in transitions.get(fulfillment.status, set()):
        raise APIError(
            409, "invalid_order_transition", "This fulfillment cannot move to the requested status."
        )
    if body.status == "shipped" and body.tracking_number is None:
        raise APIError(
            422,
            "tracking_number_required",
            "Enter a tracking number before marking this order shipped.",
        )

    if body.status == "cancelled":
        await _restock_fulfillment(session, fulfillment.id)
    if body.status == "shipped":
        fulfillment.tracking_number = body.tracking_number
    for field in ("courier_name", "support_phone", "support_email"):
        if field in body.model_fields_set:
            setattr(fulfillment, field, getattr(body, field))

    previous_status = fulfillment.status
    recorded_status = body.status
    if body.status == "return_rejected":
        fulfillment.status = "delivered"
    else:
        fulfillment.status = body.status
    session.add(
        OrderStatusEvent(
            order_id=fulfillment.order_id,
            fulfillment_order_id=fulfillment.id,
            actor_id=user.id,
            from_status=previous_status,
            to_status=recorded_status,
            note=body.note,
            location=body.location,
            created_at=datetime.now(timezone.utc),
        )
    )
    order = await session.get(CustomerOrder, fulfillment.order_id)
    if order is None:
        raise APIError(404, "order_not_found", "The order was not found.")
    _notify(
        session,
        user_id=order.customer_id,
        order_id=order.id,
        fulfillment_id=fulfillment.id,
        title=f"Order {recorded_status.replace('_', ' ').title()}",
        message=(
            f"{shop.name} updated fulfillment {fulfillment.fulfillment_number} "
            f"to {recorded_status.replace('_', ' ')}."
        ),
    )
    if body.status == "cancelled":
        transactions = await session.scalars(
            select(PaymentTransaction).where(
                PaymentTransaction.fulfillment_order_id == fulfillment.id,
                PaymentTransaction.transaction_type == "charge",
            )
        )
        for transaction in transactions:
            transaction.status = "cancelled"
            transaction.recorded_by_id = user.id
    elif body.status == "delivered" and body.cash_collected:
        transactions = await session.scalars(
            select(PaymentTransaction).where(
                PaymentTransaction.fulfillment_order_id == fulfillment.id,
                PaymentTransaction.transaction_type == "charge",
                PaymentTransaction.status == "pending",
            )
        )
        for transaction in transactions:
            transaction.status = "collected"
            transaction.recorded_by_id = user.id
    elif body.status == "returned":
        await _restock_fulfillment(session, fulfillment.id)
        charges = await session.scalars(
            select(PaymentTransaction).where(
                PaymentTransaction.fulfillment_order_id == fulfillment.id,
                PaymentTransaction.transaction_type == "charge",
            )
        )
        for charge in charges:
            if charge.status == "collected":
                session.add(
                    PaymentTransaction(
                        order_id=fulfillment.order_id,
                        fulfillment_order_id=fulfillment.id,
                        transaction_type="refund",
                        method="cash_on_delivery",
                        status="refund_due",
                        amount=charge.amount,
                        recorded_by_id=user.id,
                    )
                )
            else:
                charge.status = "cancelled"
                charge.recorded_by_id = user.id
    elif body.status == "return_rejected":
        refund_transactions = await session.scalars(
            select(PaymentTransaction).where(
                PaymentTransaction.fulfillment_order_id == fulfillment.id,
                PaymentTransaction.transaction_type == "refund",
                PaymentTransaction.status == "refund_due",
            )
        )
        for transaction in refund_transactions:
            transaction.status = "cancelled"
            transaction.recorded_by_id = user.id

    await _recalculate_order_status(session, fulfillment.order_id)
    await session.commit()
    await session.refresh(fulfillment)
    return await _fulfillment_read(session, fulfillment)


@router.post(
    "/vendor/fulfillment-orders/{fulfillment_id}/refund", response_model=FulfillmentOrderRead
)
async def record_cash_refund(
    fulfillment_id: UUID,
    user: Annotated[User, Depends(get_current_vendor)],
    shop: Annotated[Shop, Depends(get_selected_shop)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> FulfillmentOrderRead:
    fulfillment = await _vendor_fulfillment(session, shop, fulfillment_id)
    if fulfillment.status != "returned":
        raise APIError(
            409, "refund_unavailable", "A cash refund can only be recorded for a returned order."
        )
    refunds = await session.scalars(
        select(PaymentTransaction).where(
            PaymentTransaction.fulfillment_order_id == fulfillment.id,
            PaymentTransaction.transaction_type == "refund",
            PaymentTransaction.status == "refund_due",
        )
    )
    transactions = list(refunds)
    if not transactions:
        raise APIError(409, "refund_not_due", "There is no outstanding cash refund for this order.")
    for transaction in transactions:
        transaction.status = "refunded"
        transaction.recorded_by_id = user.id
    order = await session.get(CustomerOrder, fulfillment.order_id)
    if order is not None:
        _notify(
            session,
            user_id=order.customer_id,
            order_id=order.id,
            fulfillment_id=fulfillment.id,
            title="Cash refund recorded",
            message=f"A cash refund was recorded for fulfillment {fulfillment.fulfillment_number}.",
        )
    await session.commit()
    await session.refresh(fulfillment)
    return await _fulfillment_read(session, fulfillment)


def _notification_query(context: WorkspaceContext) -> Select[OrderNotification]:
    if context.workspace == "vendor" and context.shop is None:
        raise APIError(422, "shop_context_required", "Select a shop to continue.")
    return select(OrderNotification).where(
        OrderNotification.user_id == context.user.id,
        (OrderNotification.workspace == "account")
        | (
            (OrderNotification.workspace == context.workspace)
            & (
                OrderNotification.shop_id == context.shop.id
                if context.shop is not None
                else OrderNotification.shop_id.is_(None)
            )
        ),
    )


@router.get("/me/notifications", response_model=list[NotificationRead])
async def list_notifications(
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[NotificationRead]:
    notifications = await session.scalars(
        _notification_query(context)
        .order_by(OrderNotification.created_at.desc())
        .limit(100)
    )
    return [NotificationRead.model_validate(item) for item in notifications]


@router.post("/me/notifications/batch", response_model=list[NotificationRead])
async def update_notifications(
    payload: NotificationBatchUpdate,
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[NotificationRead]:
    notifications = list(
        await session.scalars(
            _notification_query(context)
            .where(OrderNotification.id.in_(payload.ids))
            .order_by(OrderNotification.id)
            .with_for_update()
        )
    )
    if len(notifications) != len(payload.ids):
        raise APIError(404, "notification_not_found", "A selected notification was not found.")
    now = datetime.now(timezone.utc)
    for notification in notifications:
        if payload.action == "delete":
            await session.delete(notification)
        else:
            notification.read_at = (
                notification.read_at or now if payload.action == "read" else None
            )
    await session.commit()
    if payload.action == "delete":
        return []
    for notification in notifications:
        await session.refresh(notification)
    return [NotificationRead.model_validate(item) for item in notifications]


@router.patch("/me/notifications/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: UUID,
    context: Annotated[WorkspaceContext, Depends(get_workspace_context)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> NotificationRead:
    notification = await session.scalar(
        _notification_query(context)
        .where(OrderNotification.id == notification_id)
        .with_for_update()
    )
    if notification is None:
        raise APIError(404, "notification_not_found", "The notification was not found.")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(notification)
    return NotificationRead.model_validate(notification)
