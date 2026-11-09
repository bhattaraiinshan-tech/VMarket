import json
import logging

from app.core.logging import JsonFormatter


def test_json_formatter_includes_safe_email_delivery_diagnostics() -> None:
    record = logging.LogRecord(
        name="app.identity.router",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="Identity email delivery failed",
        args=(),
        exc_info=None,
    )
    record.error_code = "email_delivery_failed"
    record.failure_type = "EmailDeliveryError"
    record.provider_error = "Brevo rejected email (HTTP 503)"

    formatted = json.loads(JsonFormatter().format(record))

    assert formatted["error_code"] == "email_delivery_failed"
    assert formatted["failure_type"] == "EmailDeliveryError"
    assert formatted["provider_error"] == "Brevo rejected email (HTTP 503)"
