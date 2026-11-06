"""Focused preservation tests for revision 0007.

PostgreSQL tests are opt-in:
    VMARKET_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://... pytest <this file>

The supplied database is only a connection endpoint. Each test creates and
finally drops its own random schema, sets search_path to that schema alone, and
runs the actual historical revisions there. No application schema is migrated.
JSON fixtures are written alongside this file and removed in finally blocks;
neither real records nor private owner configuration is stored in this source.
"""

import asyncio
import importlib.util
import json
import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

VERSIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, VERSIONS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def migration(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    module = _load("0007_profile_workspace_isolation")
    monkeypatch.setattr(module, "context", SimpleNamespace(get_x_argument=lambda **_: {}))
    monkeypatch.setattr(module, "_configured_owner", lambda: None)
    return module


@pytest.fixture
def mapping_file() -> Iterator[Path]:
    path = Path(__file__).parent / f".workspace-map-{uuid4().hex}.json"
    try:
        yield path
    finally:
        path.unlink(missing_ok=True)


@pytest_asyncio.fixture
async def postgres() -> AsyncIterator[AsyncEngine]:
    url = os.environ.get("VMARKET_MIGRATION_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set VMARKET_MIGRATION_TEST_DATABASE_URL for isolated PostgreSQL tests")
    schema = f"test_profile_workspace_{uuid4().hex}"
    bootstrap = create_async_engine(url)
    engine = create_async_engine(
        url, connect_args={"server_settings": {"search_path": schema, "lock_timeout": "5000"}}
    )
    try:
        async with bootstrap.begin() as connection:
            await connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as connection:
            for path in sorted(VERSIONS.glob("000[1-6]_*.py")):
                await connection.run_sync(_run, _load(path.stem), "upgrade")
        yield engine
    finally:
        await engine.dispose()
        async with bootstrap.begin() as connection:
            await connection.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await bootstrap.dispose()


def _run(connection: Connection, module: ModuleType, direction: str) -> None:
    module.op = Operations(MigrationContext.configure(connection))
    getattr(module, direction)()


def _assert_schema_contract(connection: Connection) -> None:
    inspector = sa.inspect(connection)
    assert inspector.get_pk_constraint("vendor_profiles")["constrained_columns"] == ["user_id"]
    profiles = {column["name"]: column for column in inspector.get_columns("vendor_profiles")}
    assert profiles["business_name"]["type"].length == 160
    assert not profiles["business_name"]["nullable"]
    assert profiles["created_at"]["type"].timezone
    assert inspector.get_foreign_keys("vendor_profiles")[0]["options"]["ondelete"] == "CASCADE"
    owner = {column["name"]: column for column in inspector.get_columns("platform_owner")}
    assert str(owner["id"]["default"]) == "1"
    assert not owner["user_id"]["nullable"]
    assert inspector.get_foreign_keys("platform_owner")[0]["options"]["ondelete"] == "RESTRICT"
    assert inspector.get_unique_constraints("platform_owner")[0]["column_names"] == ["user_id"]
    assert {check["name"] for check in inspector.get_check_constraints("platform_owner")} == {
        "ck_platform_owner_singleton"
    }
    owner_index = next(
        index
        for index in inspector.get_indexes("shops")
        if index["name"] == "ix_shops_owner_user_id"
    )
    assert not owner_index["unique"]
    assert {
        (foreign["referred_table"], foreign["options"]["ondelete"])
        for foreign in inspector.get_foreign_keys("shops")
        if foreign["constrained_columns"] == ["owner_user_id"]
    } == {("users", "CASCADE"), ("vendor_profiles", "RESTRICT")}
    assert any(
        unique["name"] == "uq_shops_owner_slot"
        and unique["column_names"] == ["owner_user_id", "slot"]
        for unique in inspector.get_unique_constraints("shops")
    )
    for table, scope_check in (
        ("order_notifications", "ck_order_notifications_shop_scope"),
        ("support_tickets", "ck_support_tickets_workspace_shop"),
    ):
        columns = {column["name"]: column for column in inspector.get_columns(table)}
        assert not columns["workspace"]["nullable"]
        assert columns["workspace"]["type"].length == 16
        assert columns["shop_id"]["nullable"]
        checks = {check["name"] for check in inspector.get_check_constraints(table)}
        assert {f"ck_{table}_workspace", scope_check} <= checks
        assert any(
            foreign["constrained_columns"] == ["shop_id"]
            and foreign["referred_table"] == "shops"
            and foreign["options"]["ondelete"] == "RESTRICT"
            for foreign in inspector.get_foreign_keys(table)
        )


async def _migrate(engine: AsyncEngine, migration: ModuleType, direction: str = "upgrade") -> None:
    async with engine.begin() as connection:
        await connection.run_sync(_run, migration, direction)


async def _user(
    connection: AsyncConnection,
    *,
    vendor: bool = False,
    customer: bool = True,
    admin: bool = False,
    approved: bool | None = None,
    verified: bool = True,
) -> UUID:
    user = uuid4()
    await connection.execute(
        sa.text(
            """INSERT INTO users (id, email, password_hash, email_verified)
               VALUES (:id, :email, 'unused-test-hash', :verified)"""
        ),
        {"id": user, "email": f"{user}@example.test", "verified": verified},
    )
    for role, enabled in (("customer", customer), ("vendor", vendor), ("admin", admin)):
        if enabled:
            await connection.execute(
                sa.text("INSERT INTO user_roles (user_id, role) VALUES (:id, :role)"),
                {"id": user, "role": role},
            )
    if customer:
        await connection.execute(
            sa.text("INSERT INTO customer_profiles (user_id, full_name) VALUES (:id, 'Test User')"),
            {"id": user},
        )
    if approved if approved is not None else vendor:
        await connection.execute(
            sa.text(
                """INSERT INTO vendor_applications (
                     id, user_id, business_name, business_type, business_address, status)
                   VALUES (:id, :user, 'Test Business', 'retail', 'Test address', 'approved')"""
            ),
            {"id": uuid4(), "user": user},
        )
    return user


async def _shop(connection: AsyncConnection, user: UUID, slot: int | None = None) -> UUID:
    shop = uuid4()
    columns = ", slot" if slot is not None else ""
    values = ", :slot" if slot is not None else ""
    await connection.execute(
        sa.text(
            f"""INSERT INTO shops (id, owner_user_id, name, slug, city, province{columns})
                VALUES (:id, :user, 'Test Shop', :slug, 'Test City', 'Test Province'{values})"""
        ),
        {"id": shop, "user": user, "slug": str(shop), "slot": slot},
    )
    return shop


async def _order(
    connection: AsyncConnection,
    customer: UUID,
    shop: UUID,
    status: str = "delivered",
) -> tuple[UUID, UUID]:
    order, fulfillment = uuid4(), uuid4()
    await connection.execute(
        sa.text(
            """INSERT INTO orders (id, customer_id, order_number, invoice_number,
                 idempotency_key, shipping_address, subtotal, shipping_total, total)
               VALUES (:id, :user, :number, :number, :number, '{}', 100, 0, 100)"""
        ),
        {"id": order, "user": customer, "number": str(order)},
    )
    await connection.execute(
        sa.text(
            """INSERT INTO fulfillment_orders (id, order_id, shop_id, shop_name,
                 fulfillment_number, subtotal, shipping_fee, status)
               VALUES (:id, :order, :shop, 'Test Shop', :number, 100, 0, :status)"""
        ),
        {
            "id": fulfillment,
            "order": order,
            "shop": shop,
            "number": str(fulfillment),
            "status": status,
        },
    )
    return order, fulfillment


async def _notification(
    connection: AsyncConnection,
    user: UUID,
    title: str,
    *,
    order: UUID | None = None,
    fulfillment: UUID | None = None,
    message: str = "Test notification",
) -> UUID:
    record = uuid4()
    await connection.execute(
        sa.text(
            """INSERT INTO order_notifications (
                 id, user_id, order_id, fulfillment_order_id, title, message)
               VALUES (:id, :user, :order, :fulfillment, :title, :message)"""
        ),
        {
            "id": record,
            "user": user,
            "order": order,
            "fulfillment": fulfillment,
            "title": title,
            "message": message,
        },
    )
    return record


async def _ticket(
    connection: AsyncConnection,
    user: UUID,
    order: UUID | None = None,
) -> UUID:
    ticket = uuid4()
    await connection.execute(
        sa.text(
            """INSERT INTO support_tickets (id, created_by_id, order_id, subject, body)
               VALUES (:id, :user, :order, 'Private request', 'Private test body')"""
        ),
        {"id": ticket, "user": user, "order": order},
    )
    return ticket


def _review(path: Path, migration: ModuleType, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data), encoding="utf-8")
    migration.context = SimpleNamespace(
        get_x_argument=lambda **_: {"workspace_map": str(path.resolve())}
    )


def _entry(workspace: str, shop: UUID | None = None) -> dict[str, Any]:
    return {
        "workspace": workspace,
        "shop_id": str(shop) if shop else None,
        "reason": "Reviewed against original test correspondence",
    }


@pytest.mark.parametrize(
    "contents",
    [
        "[]",
        '{"unknown": {}}',
        '{"support_tickets": []}',
        '{"support_tickets": {}, "support_tickets": {}}',
        '{"support_tickets": {"not-a-uuid": {}}}',
        json.dumps({"support_tickets": {str(UUID(int=1)): _entry("admin")}}),
        json.dumps({"order_notifications": {str(UUID(int=1)): _entry("vendor")}}),
        json.dumps({"order_notifications": {str(UUID(int=1)): _entry("customer", UUID(int=2))}}),
        json.dumps(
            {
                "support_tickets": {
                    str(UUID(int=1)): {
                        "workspace": ["customer"],
                        "shop_id": None,
                        "reason": "Reviewed",
                    }
                }
            }
        ),
        json.dumps(
            {
                "support_tickets": {
                    str(UUID(int=1)): {"workspace": "customer", "shop_id": None, "reason": True}
                }
            }
        ),
        json.dumps(
            {
                "support_tickets": {
                    str(UUID(int=1)): {"workspace": "vendor", "shop_id": 1, "reason": "Reviewed"}
                }
            }
        ),
        json.dumps(
            {"support_tickets": {str(UUID(int=1)): {**_entry("customer"), "unexpected": "field"}}}
        ),
    ],
)
def test_review_map_rejects_malformed_input(
    migration: ModuleType,
    mapping_file: Path,
    contents: str,
) -> None:
    mapping_file.write_text(contents, encoding="utf-8")
    with pytest.raises(RuntimeError, match="workspace_map"):
        migration._read_workspace_map(str(mapping_file.resolve()))


def test_review_map_requires_absolute_existing_path(migration: ModuleType) -> None:
    with pytest.raises(RuntimeError, match="absolute JSON"):
        migration._read_workspace_map("relative.json")


def test_review_map_normalizes_uuids(migration: ModuleType, mapping_file: Path) -> None:
    record, shop = uuid4(), uuid4()
    _review(
        mapping_file,
        migration,
        {"order_notifications": {str(record).upper(): _entry("vendor", shop)}},
    )
    parsed = migration._read_workspace_map(str(mapping_file.resolve()))
    assert parsed["order_notifications"][record]["shop_id"] == shop
    assert parsed["support_tickets"] == {}


async def test_empty_upgrade_and_lossless_downgrade(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM platform_owner")) == 0
        await connection.run_sync(_assert_schema_contract)
    await _migrate(postgres, migration, "downgrade")
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT to_regclass('vendor_profiles')")) is None
        assert await connection.scalar(sa.text("SELECT count(*) FROM users")) == 0


async def test_backfills_profiles_scopes_and_retains_history(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        customer = await _user(connection)
        shop = await _shop(connection, vendor)
        order, fulfillment = await _order(connection, customer, shop)
        customer_notice = await _notification(connection, customer, "Order placed", order=order)
        vendor_notice = await _notification(
            connection, vendor, "New fulfillment order", order=order, fulfillment=fulfillment
        )
        review_notice = await _notification(
            connection, customer, "A vendor responded to your review"
        )
        customer_ticket = await _ticket(connection, customer, order)
        vendor_ticket = await _ticket(connection, vendor, order)
        support_notice = await _notification(
            connection,
            vendor,
            "Support request updated",
            order=order,
            message="Private request: resolved",
        )
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM customer_profiles")) == 2
        assert await connection.scalar(sa.text("SELECT count(*) FROM vendor_applications")) == 1
        assert await connection.scalar(sa.text("SELECT business_name FROM vendor_profiles")) == (
            "Test Business"
        )
        assert await connection.scalar(sa.text("SELECT slot FROM shops")) == 1
        notices = {
            row.id: (row.workspace, row.shop_id)
            for row in await connection.execute(
                sa.text("SELECT id, workspace, shop_id FROM order_notifications")
            )
        }
        assert notices == {
            customer_notice: ("customer", None),
            vendor_notice: ("vendor", shop),
            review_notice: ("customer", None),
            support_notice: ("vendor", shop),
        }
        tickets = {
            row.id: (row.workspace, row.shop_id)
            for row in await connection.execute(
                sa.text("SELECT id, workspace, shop_id FROM support_tickets")
            )
        }
        assert tickets == {customer_ticket: ("customer", None), vendor_ticket: ("vendor", shop)}
        assert await connection.scalar(sa.text("SELECT count(*) FROM fulfillment_orders")) == 1


async def test_legacy_admins_require_reviewed_active_verified_creator(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        await _user(connection, admin=True)
    with pytest.raises(RuntimeError, match="set VMARKET_OWNER_EMAIL"):
        await _migrate(postgres, migration)
    migration._configured_owner = lambda: "missing@example.test"
    with pytest.raises(RuntimeError, match="active, email-verified"):
        await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT to_regclass('platform_owner')")) is None
        assert (
            await connection.scalar(sa.text("SELECT count(*) FROM user_roles WHERE role='admin'"))
            == 1
        )


async def test_owner_binding_removes_extra_admins_with_immutable_audit(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        owner = await _user(connection, admin=True)
        removed = await _user(connection, admin=True)
        notice = await _notification(connection, removed, "New support ticket")
    migration._configured_owner = lambda: f"{owner}@example.test"
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT user_id FROM platform_owner")) == owner
        assert list(
            (
                await connection.execute(
                    sa.text("SELECT user_id FROM user_roles WHERE role='admin'")
                )
            ).scalars()
        ) == [owner]
        audit = (
            await connection.execute(
                sa.text(
                    "SELECT actor_id, target_id FROM audit_logs WHERE action='admin_role_removed'"
                )
            )
        ).one()
        assert tuple(audit) == (owner, str(removed))
        assert (
            await connection.scalar(
                sa.text("SELECT workspace FROM order_notifications WHERE id=:id"), {"id": notice}
            )
            == "admin"
        )
    with pytest.raises(DBAPIError, match="append-only"):
        async with postgres.begin() as connection:
            await connection.execute(sa.text("DELETE FROM audit_logs"))
    with pytest.raises(DBAPIError):
        async with postgres.begin() as connection:
            await connection.execute(sa.text("DELETE FROM users WHERE id=:id"), {"id": owner})


@pytest.mark.parametrize("vendor, approved", [(True, False), (False, True)])
async def test_contradictory_vendor_data_stops_without_partial_schema(
    postgres: AsyncEngine,
    migration: ModuleType,
    vendor: bool,
    approved: bool,
) -> None:
    async with postgres.begin() as connection:
        user = await _user(connection, vendor=vendor, approved=approved)
    with pytest.raises(RuntimeError, match=str(user)):
        await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT to_regclass('vendor_profiles')")) is None
        assert await connection.scalar(sa.text("SELECT count(*) FROM users")) == 1


async def test_shop_without_approved_vendor_stops(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        shop = await _shop(connection, await _user(connection))
    with pytest.raises(RuntimeError, match=str(shop)):
        await _migrate(postgres, migration)


async def test_ambiguous_mixed_profile_history_requires_reviewed_map(
    postgres: AsyncEngine,
    migration: ModuleType,
    mapping_file: Path,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        shop = await _shop(connection, vendor)
        ticket = await _ticket(connection, vendor)
        notice = await _notification(connection, vendor, "Unrecognized legacy event")
    with pytest.raises(RuntimeError, match="workspace_map=ABSOLUTE_JSON_PATH"):
        await _migrate(postgres, migration)
    _review(
        mapping_file,
        migration,
        {
            "support_tickets": {str(ticket): _entry("vendor", shop)},
            "order_notifications": {str(notice): _entry("account")},
        },
    )
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        row = (
            await connection.execute(
                sa.text("SELECT workspace, shop_id, body FROM support_tickets")
            )
        ).one()
        assert tuple(row) == ("vendor", shop, "Private test body")
        assert (
            await connection.scalar(sa.text("SELECT workspace FROM order_notifications"))
            == "account"
        )


async def test_review_map_rejects_foreign_shop_and_stale_record(
    postgres: AsyncEngine,
    migration: ModuleType,
    mapping_file: Path,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        other = await _user(connection, vendor=True)
        await _shop(connection, vendor)
        other_shop = await _shop(connection, other)
        ticket = await _ticket(connection, vendor)
    _review(
        mapping_file, migration, {"support_tickets": {str(ticket): _entry("vendor", other_shop)}}
    )
    with pytest.raises(RuntimeError, match="not owned"):
        await _migrate(postgres, migration)
    _review(mapping_file, migration, {"support_tickets": {str(uuid4()): _entry("customer")}})
    with pytest.raises(RuntimeError, match="unknown/stale"):
        await _migrate(postgres, migration)


async def test_review_map_cannot_override_deterministic_history(
    postgres: AsyncEngine,
    migration: ModuleType,
    mapping_file: Path,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        customer = await _user(connection)
        shop = await _shop(connection, vendor)
        order, _ = await _order(connection, customer, shop)
        notice = await _notification(connection, customer, "Order placed", order=order)
    _review(mapping_file, migration, {"order_notifications": {str(notice): _entry("account")}})
    with pytest.raises(RuntimeError, match="contradicts"):
        await _migrate(postgres, migration)


async def test_conversation_message_backfill_uses_linked_message_not_profile_guess(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        customer = await _user(connection)
        shop = await _shop(connection, vendor)
        conversation = uuid4()
        await connection.execute(
            sa.text(
                """INSERT INTO conversations (id, customer_id, shop_id)
               VALUES (:id, :customer, :shop)"""
            ),
            {"id": conversation, "customer": customer, "shop": shop},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO conversation_messages (id, conversation_id, sender_id, content)
               VALUES (:id, :conversation, :sender, 'Private message')"""
            ),
            {"id": uuid4(), "conversation": conversation, "sender": customer},
        )
        await _notification(
            connection, vendor, "New message from Test User", message="Private message"
        )
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        row = (
            await connection.execute(
                sa.text("SELECT workspace, shop_id, conversation_id FROM order_notifications")
            )
        ).one()
        assert tuple(row) == ("vendor", shop, conversation)


async def test_same_owner_unfinished_retail_stops_but_delivered_history_survives(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        shop = await _shop(connection, vendor)
        _, fulfillment = await _order(connection, vendor, shop, status="pending")
    with pytest.raises(RuntimeError, match="unfinished same-owner retail fulfillment"):
        await _migrate(postgres, migration)
    async with postgres.begin() as connection:
        await connection.execute(
            sa.text("UPDATE fulfillment_orders SET status='delivered' WHERE id=:id"),
            {"id": fulfillment},
        )
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM fulfillment_orders")) == 1


async def test_same_owner_cart_and_wholesale_preflight_preserves_reconciled_history(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    category, product, listing, rfq, quote, purchase, cart = (uuid4() for _ in range(7))
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        shop = await _shop(connection, vendor)
        await connection.execute(
            sa.text("INSERT INTO catalog_categories (id, name, slug) VALUES (:id, 'Test', :slug)"),
            {"id": category, "slug": str(category)},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO catalog_products (id, shop_id, category_id, name, slug,
                 description, sku, price, attributes)
               VALUES (:id, :shop, :category, 'Test', :slug, 'Test', 'TEST', 1, '{}')"""
            ),
            {"id": product, "shop": shop, "category": category, "slug": str(product)},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO cart_items (id, user_id, product_id, quantity)
               VALUES (:id, :user, :product, 1)"""
            ),
            {"id": cart, "user": vendor, "product": product},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO wholesale_listings (id, shop_id, product_id,
                 minimum_order_quantity, available_quantity) VALUES (:id, :shop, :product, 1, 10)"""
            ),
            {"id": listing, "shop": shop, "product": product},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO trade_rfqs (id, buyer_shop_id, seller_shop_id, listing_id,
                 quantity, delivery_terms, message)
               VALUES (:id, :shop, :shop, :listing, 1, 'Test', 'Test')"""
            ),
            {"id": rfq, "shop": shop, "listing": listing},
        )
    with pytest.raises(RuntimeError, match="unfinished same-owner retail cart"):
        await _migrate(postgres, migration)
    async with postgres.begin() as connection:
        # Explicit fixture reconciliation; upgrade itself never removes commerce records.
        await connection.execute(sa.text("DELETE FROM cart_items WHERE id=:id"), {"id": cart})
    with pytest.raises(RuntimeError, match="unfinished same-owner wholesale RFQ"):
        await _migrate(postgres, migration)
    async with postgres.begin() as connection:
        await connection.execute(
            sa.text("UPDATE trade_rfqs SET status='cancelled' WHERE id=:id"), {"id": rfq}
        )
        await connection.execute(
            sa.text(
                """INSERT INTO trade_quotes (
                 id, rfq_id, revision, quantity, unit_price, delivery_terms)
               VALUES (:id, :rfq, 1, 1, 1, 'Test')"""
            ),
            {"id": quote, "rfq": rfq},
        )
        await connection.execute(
            sa.text(
                """INSERT INTO trade_purchase_orders (id, rfq_id, quote_id, buyer_shop_id,
                 seller_shop_id, listing_id, order_number, quantity, unit_price, total,
                 delivery_terms) VALUES (:id, :rfq, :quote, :shop, :shop, :listing,
                 :number, 1, 1, 1, 'Test')"""
            ),
            {
                "id": purchase,
                "rfq": rfq,
                "quote": quote,
                "shop": shop,
                "listing": listing,
                "number": str(purchase),
            },
        )
    with pytest.raises(RuntimeError, match="unfinished same-owner wholesale order"):
        await _migrate(postgres, migration)
    async with postgres.begin() as connection:
        await connection.execute(
            sa.text("UPDATE trade_purchase_orders SET status='received' WHERE id=:id"),
            {"id": purchase},
        )
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM trade_rfqs")) == 1
        assert await connection.scalar(sa.text("SELECT count(*) FROM trade_quotes")) == 1
        assert await connection.scalar(sa.text("SELECT count(*) FROM trade_purchase_orders")) == 1


async def test_deterministic_slots_and_more_than_three_guard(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        await connection.execute(sa.text("DROP INDEX ix_shops_owner_user_id"))
        await connection.execute(
            sa.text("CREATE INDEX ix_shops_owner_user_id ON shops(owner_user_id)")
        )
        shops = [await _shop(connection, vendor) for _ in range(4)]
    with pytest.raises(RuntimeError, match="more than three shops"):
        await _migrate(postgres, migration)
    # This fixture-only fourth shop has no history. The migration itself never deletes it.
    async with postgres.begin() as connection:
        await connection.execute(sa.text("DELETE FROM shops WHERE id=:id"), {"id": shops.pop()})
    await _migrate(postgres, migration)
    async with postgres.connect() as connection:
        slots = [
            tuple(row)
            for row in await connection.execute(
                sa.text("SELECT id, slot FROM shops ORDER BY created_at, id")
            )
        ]
        assert slots == list(zip(sorted(shops), [1, 2, 3], strict=True))
    with pytest.raises(RuntimeError, match="one-shop unique index"):
        await _migrate(postgres, migration, "downgrade")


async def test_concurrent_shop_slots_and_inactive_shops_enforce_three_limit(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        vendor = await _user(connection, vendor=True)
        await _shop(connection, vendor)
    await _migrate(postgres, migration)
    ready = asyncio.Event()
    arrived = 0

    async def insert_slot(slot: int, *, race: bool = False) -> bool:
        nonlocal arrived
        try:
            async with postgres.begin() as connection:
                if race:
                    await connection.execute(sa.text("SELECT 1"))
                    arrived += 1
                    if arrived == 2:
                        ready.set()
                    await ready.wait()
                await _shop(connection, vendor, slot)
            return True
        except IntegrityError:
            return False

    assert sorted(await asyncio.gather(insert_slot(2, race=True), insert_slot(2, race=True))) == [
        False,
        True,
    ]
    assert await insert_slot(3)
    async with postgres.begin() as connection:
        await connection.execute(sa.text("UPDATE shops SET is_active=false"))
    assert not await insert_slot(4)
    assert not await insert_slot(1)
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM shops")) == 3


async def test_concurrent_owner_binding_has_one_winner(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        users = [await _user(connection) for _ in range(2)]
    await _migrate(postgres, migration)
    ready = asyncio.Event()
    arrived = 0

    async def bind(user: UUID) -> bool:
        nonlocal arrived
        try:
            async with postgres.begin() as connection:
                await connection.execute(sa.text("SELECT 1"))
                arrived += 1
                if arrived == 2:
                    ready.set()
                await ready.wait()
                await connection.execute(
                    sa.text("INSERT INTO platform_owner (user_id) VALUES (:user)"), {"user": user}
                )
            return True
        except IntegrityError:
            return False

    assert sorted(await asyncio.gather(*(bind(user) for user in users))) == [False, True]
    with pytest.raises(IntegrityError):
        async with postgres.begin() as connection:
            await connection.execute(
                sa.text("INSERT INTO platform_owner (id, user_id) VALUES (2, :user)"),
                {"user": uuid4()},
            )
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM platform_owner")) == 1
        bound = await connection.scalar(sa.text("SELECT user_id FROM platform_owner"))
    with pytest.raises(IntegrityError):
        async with postgres.begin() as connection:
            await connection.execute(sa.text("DELETE FROM users WHERE id=:id"), {"id": bound})


@pytest.mark.parametrize("table", ["order_notifications", "support_tickets"])
@pytest.mark.parametrize(
    "workspace, with_shop",
    [
        ("unknown", False),
        ("vendor", False),
        ("customer", True),
        ("admin", True),
    ],
)
async def test_workspace_checks_and_restricted_history_shop_fk(
    postgres: AsyncEngine,
    migration: ModuleType,
    table: str,
    workspace: str,
    with_shop: bool,
) -> None:
    async with postgres.begin() as connection:
        user = await _user(connection, vendor=True)
        shop = await _shop(connection, user)
    await _migrate(postgres, migration)
    extras = (
        "user_id, title, message"
        if table == "order_notifications"
        else "created_by_id, subject, body"
    )
    with pytest.raises(IntegrityError):
        async with postgres.begin() as connection:
            await connection.execute(
                sa.text(
                    f"""INSERT INTO {table} (id, {extras}, workspace, shop_id)
                    VALUES (:id, :user, 'Test', 'Test', :workspace, :shop)"""
                ),
                {
                    "id": uuid4(),
                    "user": user,
                    "workspace": workspace,
                    "shop": shop if with_shop else None,
                },
            )
    async with postgres.begin() as connection:
        await connection.execute(
            sa.text(
                f"""INSERT INTO {table} (id, {extras}, workspace, shop_id)
                VALUES (:id, :user, 'Test', 'Test', 'vendor', :shop)"""
            ),
            {"id": uuid4(), "user": user, "shop": shop},
        )
    with pytest.raises(IntegrityError):
        async with postgres.begin() as connection:
            await connection.execute(sa.text("DELETE FROM shops WHERE id=:shop"), {"shop": shop})


async def test_populated_downgrade_refuses_loss(
    postgres: AsyncEngine,
    migration: ModuleType,
) -> None:
    async with postgres.begin() as connection:
        await _user(connection, vendor=True)
    await _migrate(postgres, migration)
    with pytest.raises(RuntimeError, match="would discard vendor_profiles"):
        await _migrate(postgres, migration, "downgrade")
    async with postgres.connect() as connection:
        assert await connection.scalar(sa.text("SELECT count(*) FROM vendor_profiles")) == 1
