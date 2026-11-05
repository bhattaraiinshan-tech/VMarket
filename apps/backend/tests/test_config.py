import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_development_settings_use_local_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.environment == "development"
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert settings.minio_endpoint == "localhost:9000"


def test_production_rejects_local_credentials() -> None:
    with pytest.raises(ValidationError, match="non-local database"):
        Settings(_env_file=None, environment="production")


def test_staging_accepts_explicit_remote_services() -> None:
    settings = Settings(
        _env_file=None,
        environment="staging",
        database_url="postgresql+asyncpg://market:secret@db.example.com:5432/market",
        minio_endpoint="storage.example.com:9000",
        minio_access_key="market-staging",
        minio_secret_key="a-staging-secret-value",
        minio_secure=True,
        minio_public_url="https://media.example.com",
        mail_host="smtp.example.com",
        mail_username="market-mailer",
        mail_password="a-staging-mail-password",
        mail_starttls=True,
        web_base_url="https://staging.example.com",
        cors_origins=["https://staging.example.com"],
    )

    assert settings.environment == "staging"


def test_database_url_rejects_sync_drivers() -> None:
    with pytest.raises(ValidationError, match="postgresql\\+asyncpg"):
        Settings(_env_file=None, database_url="postgresql://localhost/market")


def test_cors_rejects_wildcard_origins() -> None:
    with pytest.raises(ValidationError, match="explicit origins"):
        Settings(_env_file=None, cors_origins=["*"])


def test_minio_public_and_private_buckets_must_be_distinct() -> None:
    with pytest.raises(ValidationError, match="must be non-empty and distinct"):
        Settings(_env_file=None, minio_private_bucket="PRODUCT-MEDIA")
