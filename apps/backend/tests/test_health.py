from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.v1 import health
from app.main import create_app


async def test_liveness_does_not_depend_on_external_services() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"]


async def test_readiness_checks_both_services(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_check = AsyncMock(return_value=True)

    def minio_check() -> bool:
        return True

    monkeypatch.setattr(health, "check_database", database_check)
    monkeypatch.setattr(health, "check_minio", minio_check)

    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "dependencies": {"database": "ok", "minio": "ok"},
    }
    database_check.assert_awaited_once()


async def test_readiness_reports_unavailable_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(health, "check_database", AsyncMock(return_value=False))

    def minio_check() -> bool:
        return True

    monkeypatch.setattr(health, "check_minio", minio_check)
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/health/ready")

    assert response.status_code == 503
    assert response.json()["dependencies"] == {
        "database": "unavailable",
        "minio": "ok",
    }


async def test_http_errors_use_the_api_error_shape() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=create_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/not-found")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"
    assert response.json()["request_id"]


async def test_validation_errors_use_the_api_error_shape() -> None:
    test_app = create_app()

    @test_app.get("/api/v1/test/validation")
    def validation_route(limit: int) -> dict[str, int]:
        return {"limit": limit}

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/test/validation?limit=invalid")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"][0]["location"] == ["query", "limit"]


async def test_unexpected_errors_are_sanitized_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    test_app = create_app()

    @test_app.get("/api/v1/test/failure")
    def failed_route() -> None:
        raise RuntimeError("sensitive connection detail")

    async with AsyncClient(
        transport=ASGITransport(app=test_app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/v1/test/failure")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_server_error"
    assert response.json()["error"]["message"] == "An unexpected error occurred."
    assert "sensitive connection detail" not in response.text
    assert response.headers["X-Request-ID"] == response.json()["request_id"]
    assert any(record.getMessage() == "Unhandled request error" for record in caplog.records)
