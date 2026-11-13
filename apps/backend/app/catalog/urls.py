from urllib.parse import quote

from app.core.config import get_settings


def public_object_url(object_name: str) -> str:
    settings = get_settings()
    return (
        f"{settings.minio_public_url.rstrip('/')}/"
        f"{quote(settings.minio_public_bucket, safe='')}/{quote(object_name, safe='/')}"
    )
