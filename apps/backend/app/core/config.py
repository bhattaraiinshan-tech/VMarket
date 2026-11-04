from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="VMARKET_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "staging", "production"] = "development"
    debug: bool = False
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    database_url: str = "postgresql+asyncpg://vmarket:vmarket-local@localhost:5432/vmarket"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "vmarket-local"
    minio_secret_key: SecretStr = SecretStr("vmarket-local-secret")
    minio_secure: bool = False
    minio_public_bucket: str = "product-media"
    minio_private_bucket: str = "vendor-documents"
    mail_host: str = "localhost"
    mail_port: int = 1025
    mail_username: str | None = None
    mail_password: SecretStr | None = None
    mail_starttls: bool = False
    mail_from: str = "no-reply@vendors-market.local"
    web_base_url: str = "http://localhost:3000"
    cors_origins: list[str] = ["http://localhost:3000"]

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError("database_url must use the postgresql+asyncpg scheme")
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("database_url must be a valid PostgreSQL URL") from exc
        if (
            not parsed.hostname
            or not parsed.path.strip("/")
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError("database_url must include a host and database name")
        return value

    @field_validator("minio_endpoint")
    @classmethod
    def validate_minio_endpoint(cls, value: str) -> str:
        parsed = urlsplit(f"//{value}")
        if not parsed.hostname or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("minio_endpoint must be a host:port value without a URL scheme")
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("minio_endpoint must contain a valid port") from exc
        if port is not None and not 1 <= port <= 65535:
            raise ValueError("minio_endpoint port must be between 1 and 65535")
        return value

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, value: list[str]) -> list[str]:
        if "*" in value:
            raise ValueError("cors_origins must list explicit origins")
        for origin in value:
            parsed = urlsplit(origin)
            try:
                port = parsed.port
            except ValueError as exc:
                raise ValueError("cors_origins must contain valid origins") from exc
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
                or (port is not None and not 1 <= port <= 65535)
            ):
                raise ValueError(
                    "cors_origins must contain valid origins without paths or credentials"
                )
        return value

    @field_validator("mail_port")
    @classmethod
    def validate_mail_port(cls, value: int) -> int:
        if not 1 <= value <= 65535:
            raise ValueError("mail_port must be between 1 and 65535")
        return value

    @field_validator("web_base_url")
    @classmethod
    def validate_web_base_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("web_base_url must contain a valid port") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError("web_base_url must be an origin without credentials or a path")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_deployment_settings(self) -> "Settings":
        if self.environment not in {"staging", "production"}:
            return self

        database = urlsplit(self.database_url)
        minio_host = urlsplit(f"//{self.minio_endpoint}").hostname
        if self.debug:
            raise ValueError("debug must be disabled in staging and production")
        if database.hostname in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("staging and production require a non-local database")
        if database.password in {"", "vmarket", "vmarket-local"}:
            raise ValueError("staging and production require a non-development database password")
        if minio_host in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("staging and production require a non-local MinIO endpoint")
        if not self.minio_secure:
            raise ValueError("MinIO TLS must be enabled in staging and production")
        if any(
            urlsplit(origin).hostname in {"localhost", "127.0.0.1", "::1"}
            or urlsplit(origin).scheme != "https"
            for origin in self.cors_origins
        ):
            raise ValueError("staging and production require remote HTTPS CORS origins")
        if self.minio_access_key == "vmarket-local":
            raise ValueError("staging and production require a non-development MinIO access key")
        if self.minio_secret_key.get_secret_value() == "vmarket-local-secret":
            raise ValueError("staging and production require a non-development MinIO secret key")
        mail_host = self.mail_host.lower()
        if mail_host in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("staging and production require a remote email service")
        if (
            not self.mail_starttls
            or not self.mail_username
            or not self.mail_password
            or not self.mail_password.get_secret_value()
        ):
            raise ValueError("staging and production require authenticated email with STARTTLS")
        if urlsplit(self.web_base_url).scheme != "https":
            raise ValueError("staging and production require an HTTPS web_base_url")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
