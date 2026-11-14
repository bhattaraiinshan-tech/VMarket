from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from test_orders import OrdersClient, _add_cart_item, _place_order, _sign_in, orders_client

from app.identity.models import PlatformOwner
from app.orders.models import DeliveryFeedback, FulfillmentOrder, OrderStatusEvent

__all__ = ["orders_client"]


async def _shipment(orders_client: OrdersClient) -> tuple[str, str]:
    client, _, ids = orders_client
    await _add_cart_item(client, ids["product1"], 1)
    placed = await _place_order(client, ids["address"])
    assert placed.status_code == 201
    order = placed.json()
    return order["id"], order["fulfillments"][0]["id"]


async def _dispatch(orders_client: OrdersClient, fulfillment: str) -> None:
    client, _, _ = orders_client
    _sign_in(client, "vendor1")
    for status in ("confirmed", "processing", "shipped"):
        response = await client.patch(
            f"/api/v1/vendor/fulfillment-orders/{fulfillment}/status",
            json={
                "status": status,
                **(
                    {
                        "tracking_number": "NP-TRACK-123",
                        "courier_name": " Nepal Delivery ",
                        "support_phone": "+977 9800000000",
                        "support_email": "delivery@example.com",
                        "location": "Kathmandu hub",
                    }
                    if status == "shipped"
                    else {}
                ),
            },
        )
        assert response.status_code == 200, response.text


async def test_tracking_milestones_contacts_and_feedback_round_trip(
    orders_client: OrdersClient,
) -> None:
    client, factory, _ = orders_client
    order_id, fulfillment_id = await _shipment(orders_client)
    await _dispatch(orders_client, fulfillment_id)
    for status, location in (
        ("picked_up", "Kathmandu hub"),
        ("in_transit", "Lalitpur distribution center"),
        ("out_for_delivery", "Lalitpur"),
        ("delivered", "Customer address"),
    ):
        response = await client.patch(
            f"/api/v1/vendor/fulfillment-orders/{fulfillment_id}/status",
            json={
                "status": status,
                "location": location,
                "note": f"Reported {status}",
                "cash_collected": status == "delivered",
            },
        )
        assert response.status_code == 200, response.text
        assert any(
            event["to_status"] == status and event["location"] == location
            for event in response.json()["events"]
        )
    _sign_in(client, "customer")
    loaded = (await client.get(f"/api/v1/me/orders/{order_id}")).json()
    assert loaded["status"] == "completed"
    shipment = loaded["fulfillments"][0]
    assert shipment["courier_name"] == "Nepal Delivery"
    assert shipment["support_phone"] == "+977 9800000000"
    assert shipment["support_email"] == "delivery@example.com"
    assert shipment["can_request_return"] is True
    assert shipment["return_deadline"] is not None
    assert shipment["transactions"][0]["status"] == "collected"
    before_events = shipment["events"]
    before_update = shipment["updated_at"]
    endpoint = f"/api/v1/me/fulfillment-orders/{fulfillment_id}/delivery-feedback"
    for rating in (5, 5, 2):
        response = await client.put(endpoint, json={"rating": rating})
        assert response.status_code == 200, response.text
        assert response.json()["rating"] == rating
    reloaded = (await client.get(f"/api/v1/me/orders/{order_id}")).json()["fulfillments"][0]
    assert reloaded["delivery_feedback"]["rating"] == 2
    assert reloaded["events"] == before_events
    assert reloaded["updated_at"] == before_update
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DeliveryFeedback)) == 1
    returned = await client.post(f"/api/v1/me/fulfillment-orders/{fulfillment_id}/returns")
    assert returned.status_code == 200
    assert returned.json()["fulfillments"][0]["delivery_feedback"]["rating"] == 2


async def test_delivery_feedback_requires_owner_customer_workspace_and_completed_delivery(
    orders_client: OrdersClient,
) -> None:
    client, factory, ids = orders_client
    _, fulfillment = await _shipment(orders_client)
    endpoint = f"/api/v1/me/fulfillment-orders/{fulfillment}/delivery-feedback"
    assert (await client.put(endpoint, json={"rating": 5})).status_code == 409
    for rating in (0, 6, "5", True, 2.5):
        assert (await client.put(endpoint, json={"rating": rating})).status_code == 422
    await _dispatch(orders_client, fulfillment)
    _sign_in(client, "vendor2")
    assert (await client.put(endpoint, json={"rating": 5})).status_code == 403
    client.headers["X-VMarket-Workspace"] = "customer"
    client.headers.pop("X-VMarket-Shop-Id")
    assert (await client.put(endpoint, json={"rating": 5})).status_code == 404
    _sign_in(client, "customer")
    async with factory() as session:
        session.add(PlatformOwner(user_id=ids["customer"]))
        await session.commit()
    client.headers["X-VMarket-Workspace"] = "admin"
    assert (await client.put(endpoint, json={"rating": 5})).status_code == 403
    client.cookies.clear()
    client.headers["X-VMarket-Workspace"] = "customer"
    assert (await client.put(endpoint, json={"rating": 5})).status_code == 401
    async with factory() as session:
        assert await session.scalar(select(func.count()).select_from(DeliveryFeedback)) == 0


async def test_tracking_updates_remain_selected_shop_scoped_and_forward_only(
    orders_client: OrdersClient,
) -> None:
    client, factory, _ = orders_client
    _, fulfillment = await _shipment(orders_client)
    await _dispatch(orders_client, fulfillment)
    endpoint = f"/api/v1/vendor/fulfillment-orders/{fulfillment}/status"
    _sign_in(client, "vendor2")
    assert (
        await client.patch(endpoint, json={"status": "in_transit", "location": "Wrong shop"})
    ).status_code == 404
    _sign_in(client, "vendor1")
    for payload in (
        {"status": "in_transit", "location": 123},
        {"status": "in_transit", "support_email": "not-an-email"},
        {"status": "in_transit", "support_phone": "javascript:alert(1)"},
        {"status": "in_transit", "courier_name": "x" * 121},
        {"status": "in_transit", "location": "x" * 181},
    ):
        assert (await client.patch(endpoint, json=payload)).status_code == 422
    assert (
        await client.patch(
            endpoint, json={"status": "out_for_delivery", "location": "Verified hub"}
        )
    ).status_code == 200
    assert (await client.patch(endpoint, json={"status": "picked_up"})).status_code == 409
    assert (await client.patch(endpoint, json={"status": "cancelled"})).status_code == 409
    _sign_in(client, "customer")
    assert (
        await client.post(f"/api/v1/me/fulfillment-orders/{fulfillment}/cancel")
    ).status_code == 409
    async with factory() as session:
        saved = await session.get(FulfillmentOrder, UUID(fulfillment))
        assert saved is not None and saved.status == "out_for_delivery"
        events = list(
            await session.scalars(
                select(OrderStatusEvent).where(OrderStatusEvent.fulfillment_order_id == saved.id)
            )
        )
        assert not any(event.location == "Wrong shop" for event in events)


async def test_return_eligibility_uses_current_server_policy_and_preserves_delivery_time(
    orders_client: OrdersClient,
) -> None:
    client, factory, _ = orders_client
    order_id, fulfillment = await _shipment(orders_client)
    await _dispatch(orders_client, fulfillment)
    delivered = await client.patch(
        f"/api/v1/vendor/fulfillment-orders/{fulfillment}/status", json={"status": "delivered"}
    )
    assert delivered.status_code == 200
    async with factory() as session:
        event = await session.scalar(
            select(OrderStatusEvent).where(
                OrderStatusEvent.fulfillment_order_id == UUID(fulfillment),
                OrderStatusEvent.to_status == "delivered",
            )
        )
        assert event is not None
        event.created_at = datetime.now(timezone.utc) - timedelta(days=8)
        await session.commit()
    _sign_in(client, "customer")
    shipment = (await client.get(f"/api/v1/me/orders/{order_id}")).json()["fulfillments"][0]
    assert shipment["can_request_return"] is False
    assert shipment["return_deadline"] is not None
    assert (
        await client.post(f"/api/v1/me/fulfillment-orders/{fulfillment}/returns")
    ).status_code == 409
    assert (
        await client.put(
            f"/api/v1/me/fulfillment-orders/{fulfillment}/delivery-feedback", json={"rating": 4}
        )
    ).status_code == 200
