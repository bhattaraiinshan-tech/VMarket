from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine
from test_profile_workspace_migration import _load, _migrate, _order, _shop, _user, postgres

__all__ = ["postgres"]


@pytest_asyncio.fixture
async def database(postgres: AsyncEngine, monkeypatch: pytest.MonkeyPatch) -> AsyncEngine:
    profile = _load("0007_profile_workspace_isolation")
    monkeypatch.setattr(profile, "context", SimpleNamespace(get_x_argument=lambda **_: {}))
    monkeypatch.setattr(profile, "_configured_owner", lambda: None)
    await _migrate(postgres, profile)
    await _migrate(postgres, _load("0008_phase7_operations"))
    fraud = _load("0009_fraud_workspace_scope")
    monkeypatch.setattr(fraud, "context", SimpleNamespace(get_x_argument=lambda **_: {}))
    await _migrate(postgres, fraud)
    return postgres


async def test_tracking_upgrade_and_empty_downgrade_preserve_historical_records(
    database: AsyncEngine,
) -> None:
    async with database.begin() as connection:
        customer = await _user(connection)
        vendor = await _user(connection, vendor=True)
        await connection.execute(
            sa.text(
                "INSERT INTO vendor_profiles(user_id,business_name) VALUES(:user,'Test business')"
            ),
            {"user": vendor},
        )
        shop = await _shop(connection, vendor, slot=1)
        order, fulfillment = await _order(connection, customer, shop)
        event = uuid4()
        await connection.execute(
            sa.text(
                "INSERT INTO order_status_events(id,order_id,fulfillment_order_id,to_status,note) "
                "VALUES(:id,:order,:fulfillment,'delivered','Preserve historical delivery')"
            ),
            {"id": event, "order": order, "fulfillment": fulfillment},
        )
        before = (
            (
                await connection.execute(
                    sa.text("SELECT * FROM fulfillment_orders WHERE id=:id"), {"id": fulfillment}
                )
            )
            .mappings()
            .one()
        )
    migration = _load("0010_delivery_tracking")
    await _migrate(database, migration)
    async with database.connect() as connection:
        after = (
            (
                await connection.execute(
                    sa.text("SELECT * FROM fulfillment_orders WHERE id=:id"), {"id": fulfillment}
                )
            )
            .mappings()
            .one()
        )
        assert {key: after[key] for key in before} == dict(before)
        assert all(after[key] is None for key in ("courier_name", "support_phone", "support_email"))
        assert (
            await connection.execute(
                sa.text("SELECT note,location FROM order_status_events WHERE id=:id"), {"id": event}
            )
        ).one() == ("Preserve historical delivery", None)
    await _migrate(database, migration, "downgrade")
    async with database.connect() as connection:
        assert (
            await connection.execute(
                sa.text("SELECT * FROM fulfillment_orders WHERE id=:id"), {"id": fulfillment}
            )
        ).mappings().one() == before


@pytest.mark.parametrize("record_type", ["courier", "milestone", "location", "feedback"])
async def test_tracking_downgrade_refuses_to_discard_new_data(
    database: AsyncEngine,
    record_type: str,
) -> None:
    migration = _load("0010_delivery_tracking")
    await _migrate(database, migration)
    async with database.begin() as connection:
        customer = await _user(connection)
        vendor = await _user(connection, vendor=True)
        await connection.execute(
            sa.text(
                "INSERT INTO vendor_profiles(user_id,business_name) VALUES(:user,'Test business')"
            ),
            {"user": vendor},
        )
        shop = await _shop(connection, vendor, slot=1)
        order, fulfillment = await _order(connection, customer, shop)
        if record_type == "courier":
            await connection.execute(
                sa.text("UPDATE fulfillment_orders SET courier_name='Test Courier' WHERE id=:id"),
                {"id": fulfillment},
            )
        elif record_type in {"milestone", "location"}:
            await connection.execute(
                sa.text(
                    "INSERT INTO order_status_events"
                    "(id,order_id,fulfillment_order_id,to_status,location) "
                    "VALUES(:id,:order,:fulfillment,:status,:location)"
                ),
                {
                    "id": uuid4(),
                    "order": order,
                    "fulfillment": fulfillment,
                    "status": "in_transit" if record_type == "milestone" else "delivered",
                    "location": "Preserve hub" if record_type == "location" else None,
                },
            )
        else:
            await connection.execute(
                sa.text(
                    "INSERT INTO delivery_feedback(fulfillment_order_id,customer_id,rating) "
                    "VALUES(:fulfillment,:customer,5)"
                ),
                {"fulfillment": fulfillment, "customer": customer},
            )
    with pytest.raises(RuntimeError, match="discard delivery"):
        await _migrate(database, migration, "downgrade")
    async with database.connect() as connection:
        assert await connection.run_sync(
            lambda conn: sa.inspect(conn).has_table("delivery_feedback")
        )
        assert (
            await connection.execute(
                sa.text("SELECT count(*) FROM fulfillment_orders WHERE id=:id"), {"id": fulfillment}
            )
        ).scalar() == 1
