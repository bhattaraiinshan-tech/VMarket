"""Preserve profiles and isolate workspace history.

Revision ID: 0007_profile_workspace_isolation
Revises: 0006_vendor_trade

Run online, in Alembic's PostgreSQL transaction, with application writers stopped.
Existing admin grants require VMARKET_OWNER_EMAIL naming an active verified user.
No existing admins means ownership remains unprovisioned for the owner CLI.

Ambiguous history requires an operator-reviewed JSON file, passed with:
    alembic -x workspace_map=ABSOLUTE_JSON_PATH upgrade head

Format (all UUIDs below are placeholders, not actual records):
    {
      "order_notifications": {
        "<record UUID>": {
          "workspace": "vendor", "shop_id": "<owned shop UUID>",
          "reason": "Reviewed against the original business correspondence"
        }
      },
      "support_tickets": {
        "<record UUID>": {
          "workspace": "customer", "shop_id": null,
          "reason": "Reviewed original request with its author"
        }
      }
    }

Both top-level keys are optional; every entry requires exactly these three
fields. Unknown IDs, duplicate keys, invalid types, incompatible ownership,
and overrides contradicting unambiguous linked history are rejected. Keep this
private operational file outside source control. Diagnostics list record IDs,
never email addresses, message bodies, credentials, or document contents.

Downgrade is deliberately conservative: populated new entities or scoped history
cannot be discarded, even when some values could be inferred again later.
"""

import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.engine import Connection

revision: str = "0007_profile_workspace_isolation"
down_revision: str | None = "0006_vendor_trade"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

Scope = tuple[str, UUID | None]
WORKSPACES = {
    "order_notifications": {"customer", "vendor", "admin", "account"},
    "support_tickets": {"customer", "vendor"},
}


def _fail(message: str) -> None:
    raise RuntimeError(f"{revision}: {message}; no history was deleted. Reconcile and retry.")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail("workspace_map contains duplicate JSON keys")
        result[key] = value
    return result


def _read_workspace_map(path: str | None) -> dict[str, dict[UUID, dict[str, Any]]]:
    if path is None:
        return {name: {} for name in WORKSPACES}
    file = Path(path)
    if not file.is_absolute() or not file.is_file():
        _fail("workspace_map must name an existing absolute JSON file")
    try:
        if file.stat().st_size > 10 * 1024 * 1024:
            _fail("workspace_map exceeds the 10 MiB limit; split the reviewed reconciliation")
        data = json.loads(file.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)
    except (OSError, UnicodeError, ValueError):
        _fail("workspace_map must be readable UTF-8 JSON")
    if not isinstance(data, dict) or set(data) - WORKSPACES.keys():
        _fail("workspace_map accepts only order_notifications and support_tickets objects")
    result: dict[str, dict[UUID, dict[str, Any]]] = {}
    for table, allowed in WORKSPACES.items():
        entries = data.get(table, {})
        if not isinstance(entries, dict):
            _fail(f"workspace_map.{table} must be an object keyed by record UUID")
        result[table] = {}
        for key, value in entries.items():
            try:
                record_id = UUID(key)
            except (TypeError, ValueError, AttributeError):
                _fail(f"workspace_map.{table} has an invalid record UUID")
            if record_id in result[table]:
                _fail(f"workspace_map.{table} repeats a normalized record UUID")
            if not isinstance(value, dict) or set(value) != {"workspace", "shop_id", "reason"}:
                _fail(f"workspace_map.{table}[{record_id}] requires workspace, shop_id, reason")
            if not isinstance(value["workspace"], str) or value["workspace"] not in allowed:
                _fail(f"workspace_map.{table}[{record_id}] has an invalid workspace")
            if (
                not isinstance(value["reason"], str)
                or not 1 <= len(value["reason"].strip()) <= 1000
            ):
                _fail(f"workspace_map.{table}[{record_id}] requires a review reason (1-1000 chars)")
            shop_id = value["shop_id"]
            if shop_id is not None:
                if not isinstance(shop_id, str):
                    _fail(f"workspace_map.{table}[{record_id}] shop_id must be a UUID or null")
                try:
                    shop_id = UUID(shop_id)
                except ValueError:
                    _fail(f"workspace_map.{table}[{record_id}] has an invalid shop UUID")
            if (value["workspace"] == "vendor") != (shop_id is not None):
                _fail(f"workspace_map.{table}[{record_id}] only vendor scope requires a shop")
            result[table][record_id] = {**value, "shop_id": shop_id}
    return result


def _configured_owner() -> str | None:
    from app.core.config import get_settings

    value = get_settings().owner_email
    return str(value).strip().casefold() if value else None


def _rows(connection: Connection, query: str) -> list[dict[str, Any]]:
    return [dict(row) for row in connection.execute(sa.text(query)).mappings()]


def _reject_rows(connection: Connection, query: str, reason: str) -> None:
    rows = _rows(connection, query + " LIMIT 20")
    if rows:
        _fail(f"{reason}; affected IDs (up to 20): " + ", ".join(str(row["id"]) for row in rows))


def _preflight(connection: Connection) -> tuple[UUID | None, set[UUID]]:
    _reject_rows(
        connection,
        """
        SELECT u.id FROM users u
        WHERE EXISTS (SELECT 1 FROM vendor_applications a
                      WHERE a.user_id = u.id AND a.status = 'approved')
          <> EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'vendor')
        """,
        "approved vendor application and vendor role disagree; review approval/role history",
    )
    _reject_rows(
        connection,
        """
        SELECT s.id FROM shops s WHERE NOT EXISTS (
          SELECT 1 FROM vendor_applications a JOIN user_roles r ON r.user_id = a.user_id
          WHERE a.user_id = s.owner_user_id AND a.status = 'approved' AND r.role = 'vendor')
        """,
        "shop owner has no consistent approved vendor application and vendor role",
    )
    _reject_rows(
        connection,
        """SELECT user_id AS id FROM vendor_applications WHERE status = 'approved'
           GROUP BY user_id HAVING count(*) <> 1 OR bool_or(trim(business_name) = '')""",
        "approved vendor application needs a unique nonempty business name",
    )
    _reject_rows(
        connection,
        "SELECT owner_user_id AS id FROM shops GROUP BY owner_user_id HAVING count(*) > 3",
        "vendor owns more than three shops (including inactive); review without deleting history",
    )
    for query, reason in (
        (
            """SELECT c.id FROM cart_items c JOIN catalog_products p ON p.id = c.product_id
               JOIN shops s ON s.id = p.shop_id WHERE c.user_id = s.owner_user_id""",
            "unfinished same-owner retail cart; reconcile explicitly before cutover",
        ),
        (
            """SELECT f.id FROM fulfillment_orders f JOIN orders o ON o.id = f.order_id
               JOIN shops s ON s.id = f.shop_id WHERE o.customer_id = s.owner_user_id
               AND f.status NOT IN ('delivered', 'cancelled', 'returned')""",
            "unfinished same-owner retail fulfillment; reconcile status/reservations explicitly",
        ),
        (
            """SELECT p.id FROM payment_transactions p JOIN orders o ON o.id = p.order_id
               JOIN fulfillment_orders f ON f.id = p.fulfillment_order_id
               JOIN shops s ON s.id = f.shop_id WHERE o.customer_id = s.owner_user_id
               AND p.status IN ('pending', 'refund_due')""",
            "unfinished same-owner payment/refund; reconcile financial obligations explicitly",
        ),
        (
            """SELECT r.id FROM trade_rfqs r JOIN shops b ON b.id = r.buyer_shop_id
               JOIN shops s ON s.id = r.seller_shop_id
               WHERE b.owner_user_id = s.owner_user_id
               AND (r.status IN ('open', 'quoted') OR (r.status = 'accepted' AND NOT EXISTS (
                 SELECT 1 FROM trade_purchase_orders p WHERE p.rfq_id = r.id
                 AND p.status IN ('received', 'cancelled'))))""",
            "unfinished same-owner wholesale RFQ; reconcile negotiation explicitly",
        ),
        (
            """SELECT p.id FROM trade_purchase_orders p JOIN shops b ON b.id = p.buyer_shop_id
               JOIN shops s ON s.id = p.seller_shop_id
               WHERE b.owner_user_id = s.owner_user_id
               AND p.status NOT IN ('received', 'cancelled')""",
            "unfinished same-owner wholesale order; reconcile status/reservations explicitly",
        ),
    ):
        _reject_rows(connection, query, reason)
    admins = {
        row["user_id"]
        for row in _rows(connection, "SELECT user_id FROM user_roles WHERE role='admin'")
    }
    if not admins:
        return None, admins
    email = _configured_owner()
    if not email:
        _fail(
            "legacy admins exist; set VMARKET_OWNER_EMAIL to the reviewed private creator identity"
        )
    owners = list(
        connection.execute(
            sa.text(
                """SELECT id FROM users WHERE lower(trim(email)) = :email
                   AND email_verified IS TRUE AND account_status = 'active'"""
            ),
            {"email": email},
        ).scalars()
    )
    if len(owners) != 1:
        _fail("VMARKET_OWNER_EMAIL must match exactly one active, email-verified creator account")
    return owners[0], admins


def _history_scopes(
    connection: Connection,
    reviewed: dict[str, dict[UUID, dict[str, Any]]],
    owner: UUID | None,
    admins: set[UUID],
) -> tuple[dict[str, dict[UUID, Scope]], dict[UUID, UUID]]:
    shops = {row["id"]: row["owner_user_id"] for row in _rows(connection, "SELECT * FROM shops")}
    owned_shops: dict[UUID, set[Scope]] = {}
    for shop, user in shops.items():
        owned_shops.setdefault(user, set()).add(("vendor", shop))
    customers = {
        row["user_id"] for row in _rows(connection, "SELECT user_id FROM customer_profiles")
    }
    orders = {row["id"]: row for row in _rows(connection, "SELECT id, customer_id FROM orders")}
    fulfillments = {
        row["id"]: row
        for row in _rows(connection, "SELECT id, order_id, shop_id FROM fulfillment_orders")
    }
    fulfillments_by_order: dict[UUID, list[dict[str, Any]]] = {}
    for fulfillment in fulfillments.values():
        fulfillments_by_order.setdefault(fulfillment["order_id"], []).append(fulfillment)
    tickets = _rows(connection, "SELECT * FROM support_tickets ORDER BY id")
    tickets_by_author_order: dict[tuple[UUID, UUID | None], list[dict[str, Any]]] = {}
    for ticket in tickets:
        tickets_by_author_order.setdefault(
            (ticket["created_by_id"], ticket["order_id"]), []
        ).append(ticket)
    notifications = _rows(connection, "SELECT * FROM order_notifications ORDER BY id")
    scopes: dict[str, dict[UUID, Scope]] = {table: {} for table in WORKSPACES}
    conversation_links: dict[UUID, UUID] = {}
    unresolved: list[str] = []

    def parties(user: UUID, order_id: UUID, fulfillment_id: UUID | None = None) -> set[Scope]:
        result: set[Scope] = set()
        if order_id in orders and orders[order_id]["customer_id"] == user:
            result.add(("customer", None))
        for fulfillment in fulfillments_by_order.get(order_id, []):
            if fulfillment_id is not None and fulfillment["id"] != fulfillment_id:
                continue
            shop_id = fulfillment["shop_id"]
            if shops.get(shop_id) == user:
                result.add(("vendor", shop_id))
        return result

    def resolve(
        table: str,
        row: dict[str, Any],
        candidates: set[Scope],
        allowed_modes: set[str] | None = None,
    ) -> None:
        record_id = row["id"]
        entry = reviewed[table].get(record_id)
        if entry is not None:
            choice = (entry["workspace"], entry["shop_id"])
            user = row["user_id"] if table == "order_notifications" else row["created_by_id"]
            if allowed_modes is not None and choice[0] not in allowed_modes:
                _fail(
                    f"workspace_map.{table}[{record_id}] contradicts the known notification purpose"
                )
            if choice[0] == "vendor" and shops.get(choice[1]) != user:
                _fail(f"workspace_map.{table}[{record_id}] shop is not owned by the record's user")
            if choice[0] == "admin" and user not in admins | {owner}:
                _fail(f"workspace_map.{table}[{record_id}] recipient was not an administrator")
            if (
                choice[0] == "customer"
                and user not in customers
                and not (
                    row["order_id"] in orders and orders[row["order_id"]]["customer_id"] == user
                )
            ):
                _fail(f"workspace_map.{table}[{record_id}] has no customer profile or linked order")
            if candidates and choice not in candidates:
                _fail(f"workspace_map.{table}[{record_id}] contradicts linked history/purpose")
            if table == "support_tickets" and row["order_id"] is not None:
                if choice not in parties(user, row["order_id"]):
                    _fail(f"workspace_map.{table}[{record_id}] is not a party to the linked order")
            if table == "order_notifications" and row["order_id"] is not None:
                if choice[0] in {"customer", "vendor"} and choice not in parties(
                    user, row["order_id"], row["fulfillment_order_id"]
                ):
                    _fail(f"workspace_map.{table}[{record_id}] is not a party to the linked order")
            scopes[table][record_id] = choice
        elif len(candidates) == 1:
            scopes[table][record_id] = next(iter(candidates))
        else:
            unresolved.append(f"{table}[{record_id}] ({len(candidates)} possible scopes)")

    for table, rows in (("support_tickets", tickets), ("order_notifications", notifications)):
        stale = set(reviewed[table]) - {row["id"] for row in rows}
        if stale:
            _fail(f"workspace_map.{table} has unknown/stale IDs: {', '.join(map(str, stale))}")

    for row in tickets:
        user = row["created_by_id"]
        if row["order_id"] is not None:
            candidates = parties(user, row["order_id"])
        else:
            candidates = {("customer", None)} if user in customers else set()
            candidates.update(owned_shops.get(user, set()))
        resolve("support_tickets", row, candidates)

    messages_by_content_time: dict[tuple[str, Any], list[dict[str, Any]]] = {}
    if any(
        row["conversation_id"] is None and row["title"].startswith("New message from ")
        for row in notifications
    ):
        for message in _rows(
            connection,
            """SELECT m.sender_id, m.content, m.created_at, c.id AS conversation_id,
                      c.customer_id, c.shop_id, c.order_id
               FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id""",
        ):
            messages_by_content_time.setdefault(
                (message["content"][:500], message["created_at"]), []
            ).append(message)
    conversations = {
        row["id"]: row
        for row in _rows(connection, "SELECT id, customer_id, shop_id, order_id FROM conversations")
    }
    for row in notifications:
        user, order_id = row["user_id"], row["order_id"]
        fulfillment_id = row["fulfillment_order_id"]
        if fulfillment_id is not None:
            linked_order = fulfillments[fulfillment_id]["order_id"]
            if order_id is not None and linked_order != order_id:
                _fail(f"order_notifications[{row['id']}] has contradictory order/fulfillment links")
            order_id = linked_order
        candidates = parties(user, order_id, fulfillment_id) if order_id is not None else set()
        title = row["title"]
        allowed_modes: set[str] | None = None
        if title in {"New support ticket", "New support dispute"}:
            allowed_modes = {"admin"}
            candidates = {("admin", None)} if user in admins | {owner} else set()
        elif title == "A vendor responded to your review":
            allowed_modes = {"customer"}
            candidates = {("customer", None)} if user in customers else set()
        elif title == "Support request updated":
            allowed_modes = {"customer", "vendor"}
            candidates = {
                scopes["support_tickets"][ticket["id"]]
                for ticket in tickets_by_author_order.get((user, row["order_id"]), [])
                if row["message"].startswith(ticket["subject"] + ": ")
                and row["message"][len(ticket["subject"]) + 2 :]
                in {"open", "in progress", "resolved", "closed"}
                and ticket["id"] in scopes["support_tickets"]
            }
        elif title.startswith("New message from "):
            allowed_modes = {"customer", "vendor"}
            candidates = set()
            linked_conversations: set[UUID] = set()
            linked = conversations.get(row["conversation_id"])
            if linked is not None:
                if order_id is not None and linked["order_id"] != order_id:
                    _fail(
                        f"order_notifications[{row['id']}] "
                        "has contradictory conversation/order links"
                    )
                if linked["customer_id"] == user:
                    candidates.add(("customer", None))
                if shops.get(linked["shop_id"]) == user:
                    candidates.add(("vendor", linked["shop_id"]))
            matches = (
                messages_by_content_time.get((row["message"], row["created_at"]), [])
                if linked is None
                else []
            )
            for message in matches:
                if message["sender_id"] == user or (
                    order_id is not None and message["order_id"] != order_id
                ):
                    continue
                shop = message["shop_id"]
                if message["customer_id"] == user and message["sender_id"] == shops.get(shop):
                    candidates.add(("customer", None))
                    linked_conversations.add(message["conversation_id"])
                if shops.get(shop) == user and message["sender_id"] == message["customer_id"]:
                    candidates.add(("vendor", shop))
                    linked_conversations.add(message["conversation_id"])
            if len(linked_conversations) == 1:
                conversation_links[row["id"]] = next(iter(linked_conversations))
        elif title in {"New fulfillment order", "Fulfillment cancelled", "Return requested"}:
            allowed_modes = {"vendor"}
            candidates = {scope for scope in candidates if scope[0] == "vendor"}
        elif (
            title == "Order placed" or title.startswith("Order ") or title == "Cash refund recorded"
        ):
            allowed_modes = {"customer"}
            candidates = {scope for scope in candidates if scope[0] == "customer"}
        resolve("order_notifications", row, candidates, allowed_modes)
    if unresolved:
        _fail(
            "ambiguous workspace history; supply reviewed "
            "-x workspace_map=ABSOLUTE_JSON_PATH (see revision docstring); affected records "
            f"(up to 30 of {len(unresolved)}): " + ", ".join(unresolved[:30])
        )
    return scopes, conversation_links


def upgrade() -> None:
    connection = op.get_bind()
    if not isinstance(connection, Connection) or connection.dialect.name != "postgresql":
        _fail("this backfill requires an online PostgreSQL connection")
    # Freeze all source relationships until preflight, backfill, and constraints commit together.
    connection.execute(
        sa.text(
            """LOCK TABLE users, user_roles, customer_profiles, vendor_applications, shops,
               cart_items, catalog_products, orders, fulfillment_orders, payment_transactions,
               trade_rfqs, trade_purchase_orders, conversations, conversation_messages,
               support_tickets, order_notifications, audit_logs IN ACCESS EXCLUSIVE MODE"""
        )
    )
    options = context.get_x_argument(as_dictionary=True)
    reviewed = _read_workspace_map(options.get("workspace_map"))
    owner, admins = _preflight(connection)
    scopes, conversation_links = _history_scopes(connection, reviewed, owner, admins)
    op.create_table(
        "vendor_profiles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("business_name", sa.String(160), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    connection.execute(
        sa.text(
            """INSERT INTO vendor_profiles (user_id, business_name, created_at)
               SELECT user_id, business_name, coalesce(reviewed_at, submitted_at)
               FROM vendor_applications WHERE status = 'approved'"""
        )
    )
    op.create_table(
        "platform_owner",
        sa.Column("id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_platform_owner_singleton"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_platform_owner_user_id"),
    )
    audit = sa.table(
        "audit_logs",
        sa.column("id", sa.Uuid()),
        sa.column("actor_id", sa.Uuid()),
        sa.column("action"),
        sa.column("target_type"),
        sa.column("target_id"),
        sa.column("details"),
    )
    if owner is not None:
        connection.execute(
            sa.text("INSERT INTO platform_owner (id, user_id) VALUES (1, :user)"), {"user": owner}
        )
        connection.execute(
            audit.insert().values(
                id=uuid4(),
                actor_id=owner,
                action="platform_owner_bound",
                target_type="user",
                target_id=str(owner),
                details=json.dumps({"migration": revision}),
            )
        )
        for admin in sorted(admins - {owner}, key=str):
            connection.execute(
                audit.insert().values(
                    id=uuid4(),
                    actor_id=owner,
                    action="admin_role_removed",
                    target_type="user",
                    target_id=str(admin),
                    details=json.dumps(
                        {"migration": revision, "reason": "sole creator owner policy"}
                    ),
                )
            )
            connection.execute(
                sa.text("DELETE FROM user_roles WHERE user_id = :user AND role = 'admin'"),
                {"user": admin},
            )
    op.add_column("shops", sa.Column("slot", sa.Integer(), nullable=True))
    connection.execute(
        sa.text(
            """UPDATE shops s SET slot = ranked.slot FROM (
                 SELECT id, row_number() OVER (PARTITION BY owner_user_id ORDER BY created_at, id)
                   AS slot FROM shops) ranked WHERE s.id = ranked.id"""
        )
    )
    op.alter_column("shops", "slot", nullable=False)
    op.create_check_constraint("ck_shops_slot", "shops", "slot BETWEEN 1 AND 3")
    op.create_unique_constraint("uq_shops_owner_slot", "shops", ["owner_user_id", "slot"])
    op.drop_index("ix_shops_owner_user_id", table_name="shops")
    op.create_index("ix_shops_owner_user_id", "shops", ["owner_user_id"], unique=False)
    op.create_foreign_key(
        "fk_shops_vendor_profile",
        "shops",
        "vendor_profiles",
        ["owner_user_id"],
        ["user_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_order_notifications_conversation_id", "order_notifications", ["conversation_id"]
    )
    for record_id, conversation_id in conversation_links.items():
        connection.execute(
            sa.text("UPDATE order_notifications SET conversation_id=:conversation WHERE id=:id"),
            {"id": record_id, "conversation": conversation_id},
        )
    for table, allowed in WORKSPACES.items():
        op.add_column(table, sa.Column("workspace", sa.String(16), nullable=True))
        op.add_column(table, sa.Column("shop_id", sa.Uuid(), nullable=True))
        for record_id, (workspace, shop_id) in scopes[table].items():
            connection.execute(
                sa.text(f"UPDATE {table} SET workspace=:workspace, shop_id=:shop WHERE id=:id"),
                {"id": record_id, "workspace": workspace, "shop": shop_id},
            )
        op.alter_column(table, "workspace", nullable=False)
        modes = ", ".join(f"'{mode}'" for mode in sorted(allowed))
        op.create_check_constraint(f"ck_{table}_workspace", table, f"workspace IN ({modes})")
        scope_constraint = (
            "ck_order_notifications_shop_scope"
            if table == "order_notifications"
            else "ck_support_tickets_workspace_shop"
        )
        op.create_check_constraint(
            scope_constraint,
            table,
            "(workspace = 'vendor' AND shop_id IS NOT NULL) OR "
            "(workspace <> 'vendor' AND shop_id IS NULL)",
        )
        op.create_foreign_key(
            f"fk_{table}_shop", table, "shops", ["shop_id"], ["id"], ondelete="RESTRICT"
        )
        op.create_index(f"ix_{table}_shop_id", table, ["shop_id"])
    op.create_index(
        "ix_order_notifications_workspace_shop_created",
        "order_notifications",
        ["user_id", "workspace", "shop_id", "created_at"],
    )
    op.create_index(
        "ix_support_tickets_workspace_shop_updated",
        "support_tickets",
        ["workspace", "shop_id", "updated_at"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    if not isinstance(connection, Connection) or connection.dialect.name != "postgresql":
        _fail("downgrade requires an online PostgreSQL connection")
    connection.execute(
        sa.text(
            """LOCK TABLE shops, vendor_profiles, platform_owner, order_notifications,
               support_tickets IN ACCESS EXCLUSIVE MODE"""
        )
    )
    _reject_rows(
        connection,
        "SELECT owner_user_id AS id FROM shops GROUP BY owner_user_id HAVING count(*) > 1",
        "downgrade cannot restore the one-shop unique index while vendors own multiple shops",
    )
    for table, key in (
        ("vendor_profiles", "user_id"),
        ("platform_owner", "user_id"),
        ("order_notifications", "id"),
        ("support_tickets", "id"),
    ):
        _reject_rows(
            connection,
            f"SELECT {key} AS id FROM {table}",
            f"downgrade would discard {table} profile/owner/scope history; retain this revision",
        )
    op.drop_index("ix_support_tickets_workspace_shop_updated", table_name="support_tickets")
    op.drop_index("ix_order_notifications_workspace_shop_created", table_name="order_notifications")
    for table in WORKSPACES:
        op.drop_index(f"ix_{table}_shop_id", table_name=table)
        op.drop_constraint(f"fk_{table}_shop", table, type_="foreignkey")
        scope_constraint = (
            "ck_order_notifications_shop_scope"
            if table == "order_notifications"
            else "ck_support_tickets_workspace_shop"
        )
        op.drop_constraint(scope_constraint, table, type_="check")
        op.drop_constraint(f"ck_{table}_workspace", table, type_="check")
        op.drop_column(table, "shop_id")
        op.drop_column(table, "workspace")
    op.drop_index("ix_order_notifications_conversation_id", table_name="order_notifications")
    op.drop_constraint("fk_shops_vendor_profile", "shops", type_="foreignkey")
    op.drop_index("ix_shops_owner_user_id", table_name="shops")
    op.create_index("ix_shops_owner_user_id", "shops", ["owner_user_id"], unique=True)
    op.drop_constraint("uq_shops_owner_slot", "shops", type_="unique")
    op.drop_constraint("ck_shops_slot", "shops", type_="check")
    op.drop_column("shops", "slot")
    op.drop_table("platform_owner")
    op.drop_table("vendor_profiles")
