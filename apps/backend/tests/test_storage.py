from unittest.mock import Mock, call

import pytest
from minio.error import S3Error

from app.storage import initialize


@pytest.mark.parametrize("exists", [False, True])
def test_initialize_buckets_is_repeatable(monkeypatch: pytest.MonkeyPatch, exists: bool) -> None:
    client = Mock()
    client.bucket_exists.return_value = exists
    monkeypatch.setattr(initialize, "get_minio_client", lambda: client)

    initialize.initialize_buckets()

    expected = [call("product-media"), call("vendor-documents")]
    assert client.bucket_exists.call_args_list == expected
    assert client.make_bucket.call_args_list == ([] if exists else expected)
    client.set_bucket_policy.assert_called_once()
    assert client.set_bucket_policy.call_args.args[0] == "product-media"
    assert '"s3:GetObject"' in client.set_bucket_policy.call_args.args[1]


def test_initialize_buckets_surfaces_access_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Mock()
    client.bucket_exists.return_value = False
    client.make_bucket.side_effect = S3Error(
        Mock(), "AccessDenied", "Access denied", "/", "request", "host"
    )
    monkeypatch.setattr(initialize, "get_minio_client", lambda: client)

    with pytest.raises(S3Error, match="AccessDenied"):
        initialize.initialize_buckets()


def test_initialize_buckets_handles_concurrent_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = Mock()
    client.bucket_exists.return_value = False
    client.make_bucket.side_effect = S3Error(
        Mock(), "BucketAlreadyOwnedByYou", "Already owned", "/", "request", "host"
    )
    monkeypatch.setattr(initialize, "get_minio_client", lambda: client)

    initialize.initialize_buckets()

    assert client.make_bucket.call_count == 2
