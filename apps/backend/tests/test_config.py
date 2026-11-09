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


def test_owner_identity_is_optional_but_validated_and_normalized() -> None:
    assert Settings(_env_file=None).owner_email is None
    assert Settings(_env_file=None, owner_email="Creator@Example.com").owner_email == (
        "creator@example.com"
    )
    with pytest.raises(ValidationError):
        Settings(_env_file=None, owner_email="not-an-email")


def test_brevo_requires_private_api_key() -> None:
    for password in ("", "   "):
        with pytest.raises(ValidationError, match="Brevo requires"):
            Settings(_env_file=None, mail_provider="brevo", mail_password=password)


def test_staging_brevo_does_not_require_smtp_configuration() -> None:
    settings = Settings(
        _env_file=None,
        environment="staging",
        database_url="postgresql+asyncpg://market:strong-password@db.example.com:5432/market",
        minio_endpoint="storage.example.com:9000",
        minio_access_key="market-staging",
        minio_secret_key="a-staging-secret-value",
        minio_secure=True,
        minio_public_url="https://media.example.com",
        mail_provider="brevo",
        mail_from="no-reply@example.com",
        mail_password="private-test-key",
        web_base_url="https://staging.example.com",
        cors_origins=["https://staging.example.com"],
    )
    assert settings.mail_provider == "brevo"


@pytest.mark.parametrize("sender", ["", " ", "no-reply@vendors-market.local"])
def test_brevo_requires_sender(sender: str) -> None:
    with pytest.raises(ValidationError, match="verified sender"):
        Settings(
            _env_file=None, mail_provider="brevo", mail_password="test-key", mail_from=sender
        )
