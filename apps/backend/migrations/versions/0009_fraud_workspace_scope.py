"""Require reviewed workspace/shop mappings for historical fraud reports.

Pass -x fraud_workspace_map=C:\\absolute\\reviewed.json when reports already exist.
File requires reviewed_by (active, verified platform owner) and reports.
Entries require id, workspace, shop_id, and a nonblank reason recording operator review.
Vendor entries require the reporter's owned shop UUID. No historical scope is inferred.
"""

import json
from pathlib import Path
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import context, op

revision = "0009_fraud_workspace_scope"
down_revision = "0008_phase7_operations"
branch_labels = None
depends_on = None


def _reviewed_map(
    raw_path: str | None,
) -> tuple[UUID | None, dict[UUID, tuple[str, UUID | None, str]]]:
    if not raw_path:
        return None, {}
    path = Path(raw_path)
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 10 * 1024 * 1024:
        raise RuntimeError("fraud_workspace_map must be an absolute JSON file under 10 MiB")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("fraud_workspace_map could not be read as JSON") from exc
    if (
        not isinstance(data, dict)
        or set(data) != {"reports", "reviewed_by"}
        or not isinstance(data["reports"], list)
    ):
        raise RuntimeError("fraud_workspace_map must contain reviewed_by and a reports array")
    try:
        actor_id = UUID(data["reviewed_by"])
    except (ValueError, TypeError, AttributeError) as exc:
        raise RuntimeError("reviewed_by must identify the platform owner by UUID") from exc
    result: dict[UUID, tuple[str, UUID | None, str]] = {}
    for entry in data["reports"]:
        if not isinstance(entry, dict) or set(entry) != {"id", "workspace", "shop_id", "reason"}:
            raise RuntimeError("Each reviewed report requires id, workspace, shop_id, and reason")
        reason = entry["reason"]
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise RuntimeError(
                "Reviewed report requires a nonblank reason of at most 2000 characters"
            )
        try:
            report_id = UUID(entry["id"])
            shop_id = UUID(entry["shop_id"]) if entry["shop_id"] is not None else None
        except (ValueError, TypeError, AttributeError) as exc:
            raise RuntimeError("Reviewed report and shop identifiers must be UUIDs") from exc
        workspace = entry["workspace"]
        if (
            not isinstance(workspace, str)
            or workspace not in {"customer", "vendor"}
            or ((workspace == "vendor") != (shop_id is not None))
        ):
            raise RuntimeError("Reviewed report has invalid workspace/shop scope")
        if report_id in result:
            raise RuntimeError("Duplicate reviewed report identifier")
        result[report_id] = (workspace, shop_id, reason.strip())
    return actor_id, result


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "LOCK TABLE fraud_reports, users, customer_profiles, vendor_profiles, shops, "
            "orders, fulfillment_orders, platform_owner IN SHARE ROW EXCLUSIVE MODE"
        )
    )
    actor_id, mapping = _reviewed_map(
        context.get_x_argument(as_dictionary=True).get("fraud_workspace_map")
    )
    reports = (
        connection.execute(
            sa.text("SELECT id, reporter_id, target_type, target_id FROM fraud_reports")
        )
        .mappings()
        .all()
    )
    if set(mapping) != {row["id"] for row in reports}:
        raise RuntimeError(
            "Existing fraud reports require exact operator-reviewed fraud_workspace_map entries; "
            "missing and stale mappings are not accepted"
        )
    if reports:
        owner = connection.execute(
            sa.text(
                "SELECT EXISTS(SELECT 1 FROM platform_owner p JOIN users u ON u.id=p.user_id "
                "WHERE p.user_id=:actor AND u.email_verified AND u.account_status='active')"
            ),
            {"actor": actor_id},
        ).scalar()
        if not owner:
            raise RuntimeError("reviewed_by must be the active, verified platform owner")
    for row in reports:
        workspace, shop_id, _ = mapping[row["id"]]
        if workspace == "customer":
            allowed = connection.execute(
                sa.text("SELECT EXISTS(SELECT 1 FROM customer_profiles WHERE user_id=:user)"),
                {"user": row["reporter_id"]},
            ).scalar()
        else:
            allowed = connection.execute(
                sa.text(
                    "SELECT EXISTS(SELECT 1 FROM shops s JOIN vendor_profiles v "
                    "ON v.user_id=s.owner_user_id WHERE s.id=:shop AND s.owner_user_id=:user)"
                ),
                {"shop": shop_id, "user": row["reporter_id"]},
            ).scalar()
        if not allowed:
            raise RuntimeError("Reviewed report profile/shop does not belong to its reporter")
        if row["target_type"] == "order":
            allowed = connection.execute(
                sa.text(
                    "SELECT EXISTS(SELECT 1 FROM orders o WHERE o.id=:target AND "
                    "((:workspace='customer' AND o.customer_id=:user) OR "
                    "(:workspace='vendor' AND EXISTS(SELECT 1 FROM fulfillment_orders f "
                    "WHERE f.order_id=o.id AND f.shop_id=:shop))))"
                ),
                {
                    "target": row["target_id"],
                    "user": row["reporter_id"],
                    "workspace": workspace,
                    "shop": shop_id,
                },
            ).scalar()
            if not allowed:
                raise RuntimeError("Historical order report requires reviewed resource access")
    op.add_column("fraud_reports", sa.Column("workspace", sa.String(20), nullable=True))
    op.add_column("fraud_reports", sa.Column("shop_id", sa.Uuid(), nullable=True))
    for report_id, (workspace, shop_id, reason) in mapping.items():
        connection.execute(
            sa.text("UPDATE fraud_reports SET workspace=:workspace, shop_id=:shop WHERE id=:id"),
            {"workspace": workspace, "shop": shop_id, "id": report_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO audit_logs(id,actor_id,action,target_type,target_id,details) "
                "VALUES(:id,:actor,'fraud_report_scope_reconciled','fraud_report',:target,:details)"
            ),
            {
                "id": uuid4(),
                "actor": actor_id,
                "target": str(report_id),
                "details": f"workspace={workspace}; shop_id={shop_id}; reviewed: {reason}",
            },
        )
    op.alter_column("fraud_reports", "workspace", nullable=False)
    op.create_foreign_key(
        "fk_fraud_reports_shop",
        "fraud_reports",
        "shops",
        ["shop_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_fraud_reports_shop_id", "fraud_reports", ["shop_id"])
    op.create_check_constraint(
        "ck_fraud_reports_workspace", "fraud_reports", "workspace IN ('customer', 'vendor')"
    )
    op.create_check_constraint(
        "ck_fraud_reports_shop_scope",
        "fraud_reports",
        "(workspace='vendor' AND shop_id IS NOT NULL) OR "
        "(workspace='customer' AND shop_id IS NULL)",
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(sa.text("LOCK TABLE fraud_reports IN ACCESS EXCLUSIVE MODE"))
    if connection.execute(sa.text("SELECT EXISTS(SELECT 1 FROM fraud_reports)")).scalar():
        raise RuntimeError("Downgrade would discard fraud-report scope history; retain revision")
    op.drop_constraint("ck_fraud_reports_shop_scope", "fraud_reports", type_="check")
    op.drop_constraint("ck_fraud_reports_workspace", "fraud_reports", type_="check")
    op.drop_index("ix_fraud_reports_shop_id", table_name="fraud_reports")
    op.drop_constraint("fk_fraud_reports_shop", "fraud_reports", type_="foreignkey")
    op.drop_column("fraud_reports", "shop_id")
    op.drop_column("fraud_reports", "workspace")
