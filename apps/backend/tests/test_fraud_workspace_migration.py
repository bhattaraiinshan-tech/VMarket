"""Run historical migrations only in isolated test schemas, never the application schema."""

import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine
from test_profile_workspace_migration import _load, _migrate, _order, _shop, _user, postgres

__all__ = ["postgres"]


@pytest.fixture
def migration(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return _load("0009_fraud_workspace_scope")


@pytest_asyncio.fixture
async def database(postgres: AsyncEngine, monkeypatch: pytest.MonkeyPatch) -> AsyncEngine:
    profile = _load("0007_profile_workspace_isolation")
    monkeypatch.setattr(profile, "context", SimpleNamespace(get_x_argument=lambda **_: {}))
    monkeypatch.setattr(profile, "_configured_owner", lambda: None)
    await _migrate(postgres, profile)
    await _migrate(postgres, _load("0008_phase7_operations"))
    return postgres


def _mapping(module: ModuleType, monkeypatch: pytest.MonkeyPatch, path: Path | None) -> None:
    monkeypatch.setattr(
        module,
        "context",
        SimpleNamespace(
            get_x_argument=lambda **_: {"fraud_workspace_map": str(path)} if path else {}
        ),
    )


async def test_empty_fraud_migration_round_trip(
    database: AsyncEngine,
    migration: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mapping(migration, monkeypatch, None)
    await _migrate(database, migration)
    async with database.connect() as connection:
        columns = await connection.run_sync(
            lambda conn: {
                column["name"]: column for column in sa.inspect(conn).get_columns("fraud_reports")
            }
        )
        assert not columns["workspace"]["nullable"]
        assert columns["shop_id"]["nullable"]
        foreign_keys = await connection.run_sync(
            lambda conn: sa.inspect(conn).get_foreign_keys("fraud_reports")
        )
        assert any(
            key["constrained_columns"] == ["shop_id"] and key["options"]["ondelete"] == "RESTRICT"
            for key in foreign_keys
        )
    await _migrate(database, migration, "downgrade")
    async with database.connect() as connection:
        columns = await connection.run_sync(
            lambda conn: sa.inspect(conn).get_columns("fraud_reports")
        )
        assert not {"shop_id", "workspace"} & {column["name"] for column in columns}


async def test_historical_fraud_mapping_is_reviewed_atomic_and_preserved(
    database: AsyncEngine,
    migration: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    async with database.begin() as connection:
        customer = await _user(connection)
        vendor = await _user(connection, vendor=True)
        owner = await _user(connection)
        await connection.execute(
            sa.text("INSERT INTO platform_owner(id,user_id) VALUES(1,:user)"),
            {"user": owner},
        )
        await connection.execute(
            sa.text(
                "INSERT INTO vendor_profiles(user_id,business_name) VALUES(:user,'Test business')"
            ),
            {"user": vendor},
        )
        shop = await _shop(connection, vendor, slot=1)
        order, _ = await _order(connection, customer, shop)
        ids = [uuid4(), uuid4()]
        for report_id, reporter in zip(ids, (customer, vendor), strict=True):
            await connection.execute(
                sa.text(
                    "INSERT INTO fraud_reports(id,reporter_id,target_type,target_id,reason,"
                    "details,status,investigation_notes) VALUES(:id,:user,'order',:target,"
                    "'Test report','Preserve details','investigating','Preserve investigation')"
                ),
                {"id": report_id, "user": reporter, "target": order},
            )
        before = (
            (await connection.execute(sa.text("SELECT * FROM fraud_reports ORDER BY id")))
            .mappings()
            .all()
        )
        audit_count = (
            await connection.execute(sa.text("SELECT count(*) FROM audit_logs"))
        ).scalar()
    _mapping(migration, monkeypatch, None)
    with pytest.raises(RuntimeError, match="operator-reviewed"):
        await _migrate(database, migration)
    async with database.connect() as connection:
        columns = await connection.run_sync(
            lambda conn: sa.inspect(conn).get_columns("fraud_reports")
        )
        assert "workspace" not in {column["name"] for column in columns}
    mapping = tmp_path / "reviewed.json"
    entries = [
        {
            "id": str(ids[0]),
            "workspace": "customer",
            "shop_id": None,
            "reason": "Reviewed customer request",
        },
        {
            "id": str(ids[1]),
            "workspace": "vendor",
            "shop_id": str(uuid4()),
            "reason": "Reviewed vendor request",
        },
    ]
    mapping.write_text(
        json.dumps({"reviewed_by": str(owner), "reports": entries}), encoding="utf-8"
    )
    _mapping(migration, monkeypatch, mapping)
    with pytest.raises(RuntimeError, match="does not belong"):
        await _migrate(database, migration)
    entries[1]["workspace"] = "customer"
    entries[1]["shop_id"] = None
    mapping.write_text(
        json.dumps({"reviewed_by": str(owner), "reports": entries}), encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="resource access"):
        await _migrate(database, migration)
    entries[1]["workspace"] = "vendor"
    entries[1]["shop_id"] = str(shop)
    mapping.write_text(
        json.dumps({"reviewed_by": str(vendor), "reports": entries}), encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="platform owner"):
        await _migrate(database, migration)
    mapping.write_text(
        json.dumps({"reviewed_by": str(owner), "reports": entries}), encoding="utf-8"
    )
    await _migrate(database, migration)
    async with database.connect() as connection:
        after = (
            (await connection.execute(sa.text("SELECT * FROM fraud_reports ORDER BY id")))
            .mappings()
            .all()
        )
        assert [{key: row[key] for key in before[0]} for row in after] == list(before)
        assert {(row["workspace"], row["shop_id"]) for row in after} == {
            ("customer", None),
            ("vendor", shop),
        }
        assert (
            await connection.execute(sa.text("SELECT count(*) FROM audit_logs"))
        ).scalar() == audit_count + 2
        decisions = (
            (
                await connection.execute(
                    sa.text(
                        "SELECT details FROM audit_logs "
                        "WHERE action='fraud_report_scope_reconciled'"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(decisions) == 2 and all("reviewed:" in decision for decision in decisions)
    with pytest.raises(RuntimeError, match="discard"):
        await _migrate(database, migration, "downgrade")
    async with database.connect() as connection:
        assert (
            await connection.execute(
                sa.text("SELECT count(*) FROM fraud_reports WHERE workspace IS NOT NULL")
            )
        ).scalar() == 2


@pytest.mark.parametrize(
    "entry",
    [
        {"workspace": "customer"},
        {"id": "invalid", "workspace": "customer", "shop_id": None, "reason": "Reviewed"},
        {"id": str(uuid4()), "workspace": {}, "shop_id": None, "reason": "Reviewed"},
        {"id": str(uuid4()), "workspace": "vendor", "shop_id": None, "reason": "Reviewed"},
    ],
)
def test_reject_invalid_reviewed_mapping(
    migration: ModuleType,
    tmp_path: Path,
    entry: object,
) -> None:
    path = tmp_path / "reviewed.json"
    path.write_text(json.dumps({"reviewed_by": str(uuid4()), "reports": [entry]}), encoding="utf-8")
    with pytest.raises(RuntimeError):
        migration._reviewed_map(str(path))


def test_reject_duplicate_reviewed_reports(migration: ModuleType, tmp_path: Path) -> None:
    entry = {"id": str(uuid4()), "workspace": "customer", "shop_id": None, "reason": "Reviewed"}
    path = tmp_path / "reviewed.json"
    path.write_text(
        json.dumps({"reviewed_by": str(uuid4()), "reports": [entry, entry]}), encoding="utf-8"
    )
    with pytest.raises(RuntimeError, match="Duplicate"):
        migration._reviewed_map(str(path))
