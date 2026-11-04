import json
import logging

from minio.error import S3Error

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.storage.client import get_minio_client

logger = logging.getLogger(__name__)


def initialize_buckets() -> None:
    settings = get_settings()
    client = get_minio_client()
    for bucket in (settings.minio_public_bucket, settings.minio_private_bucket):
        if not client.bucket_exists(bucket):
            try:
                client.make_bucket(bucket)
            except S3Error as exc:
                if exc.code != "BucketAlreadyOwnedByYou":
                    raise
        logger.info("Storage bucket ready", extra={"bucket": bucket})
    public_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"AWS": ["*"]},
                "Action": ["s3:GetObject"],
                "Resource": [f"arn:aws:s3:::{settings.minio_public_bucket}/*"],
            }
        ],
    }
    client.set_bucket_policy(settings.minio_public_bucket, json.dumps(public_policy))


if __name__ == "__main__":
    configure_logging(get_settings().log_level)
    initialize_buckets()
