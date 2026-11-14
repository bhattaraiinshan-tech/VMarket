from types import SimpleNamespace

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncEngine
from test_profile_workspace_migration import _load, _migrate, _user, postgres

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
    await _migrate(postgres, _load("0010_delivery_tracking"))
    return postgres


async def test_account_details_roundtrip_and_refusal(database: AsyncEngine) -> None:
    async with database.begin() as connection:
        user = await _user(connection)
        before = (
            await connection.execute(
                sa.text("SELECT full_name, phone FROM customer_profiles WHERE user_id=:id"),
                {"id": user},
            )
        ).one()
    migration = _load("0011_account_details")
    await _migrate(database, migration)
    await _migrate(database, migration, "downgrade")
    await _migrate(database, migration)
    async with database.begin() as connection:
        await connection.execute(
            sa.text(
                "INSERT INTO account_details(user_id, preferred_categories, business_category) "
                "VALUES(:id, '[]', 'retail')"
            ),
            {"id": user},
        )
    with pytest.raises(RuntimeError, match="discard account settings"):
        await _migrate(database, migration, "downgrade")
    async with database.connect() as connection:
        assert (
            await connection.execute(
                sa.text("SELECT full_name, phone FROM customer_profiles WHERE user_id=:id"),
                {"id": user},
            )
        ).one() == before
        assert (
            await connection.execute(
                sa.text("SELECT business_category FROM account_details WHERE user_id=:id"),
                {"id": user},
            )
        ).scalar_one() == "retail"
