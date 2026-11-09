from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.identity.dependencies import WorkspaceContext
from app.orders.models import CustomerOrder, FulfillmentOrder


async def require_order_access(
    session: AsyncSession, context: WorkspaceContext, order_id: UUID
) -> CustomerOrder:
    order = await session.get(CustomerOrder, order_id)
    if order is None:
        raise APIError(404, "order_not_found", "The order was not found.")
    if context.workspace == "customer" and order.customer_id == context.user.id:
        return order
    if context.workspace == "vendor" and context.shop is not None:
        fulfillment = await session.scalar(
            select(FulfillmentOrder.id)
            .where(
                FulfillmentOrder.order_id == order.id,
                FulfillmentOrder.shop_id == context.shop.id,
            )
            .limit(1)
        )
        if fulfillment is not None:
            return order
    raise APIError(404, "order_not_found", "The order was not found.")
