import json
import ssl
from unittest.mock import MagicMock

import pytest

from app.core.config import Settings
from app.core.errors import APIError
from app.identity import email, router


@pytest.fixture
def brevo_connection(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    settings = Settings(
        _env_file=None,
        mail_provider="brevo",
        mail_password="private-test-key",
        mail_from="no-reply@example.com",
    )
    monkeypatch.setattr(email, "get_settings", lambda: settings)
    connection = MagicMock()
    client = connection.return_value
    client.getresponse.return_value.status = 201
    client.getresponse.return_value.read.return_value = b'{"messageId":"email-id"}'
    monkeypatch.setattr(email, "HTTPSConnection", connection)
    return connection


def test_brevo_sends_expected_payload_with_verified_tls(brevo_connection: MagicMock) -> None:
    email.send_identity_email("recipient@example.com", "Verify email", "Verification link")
    context = brevo_connection.call_args.kwargs["context"]
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname
    assert brevo_connection.call_args.args == ("api.brevo.com",)
    client = brevo_connection.return_value
    args, kwargs = client.request.call_args
    assert args == ("POST", "/v3/smtp/email")
    assert kwargs["headers"]["api-key"] == "private-test-key"
    assert "Authorization" not in kwargs["headers"]
    assert json.loads(kwargs["body"]) == {
        "sender": {"email": "no-reply@example.com"},
        "to": [{"email": "recipient@example.com"}],
        "subject": "Verify email",
        "textContent": "Verification link",
    }
    client.close.assert_called_once()


@pytest.mark.parametrize("status", [502, 503, 504])
def test_brevo_retries_transient_server_errors_once(
    brevo_connection: MagicMock, monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    client = brevo_connection.return_value
    transient_response = MagicMock(status=status)
    successful_response = MagicMock(status=201)
    successful_response.read.return_value = b'{"messageId":"email-id"}'
    client.getresponse.side_effect = [transient_response, successful_response]
    monkeypatch.setattr(email.time, "sleep", MagicMock())

    email.send_identity_email("recipient@example.com", "Reset", "Reset link")

    assert client.request.call_count == 2
    assert (
        client.request.call_args_list[0].kwargs["body"]
        == client.request.call_args_list[1].kwargs["body"]
    )
    email.time.sleep.assert_called_once_with(1)


def test_brevo_stops_after_one_transient_server_error_retry(
    brevo_connection: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = brevo_connection.return_value
    client.getresponse.side_effect = [MagicMock(status=503), MagicMock(status=503)]
    monkeypatch.setattr(email.time, "sleep", MagicMock())

    with pytest.raises(email.EmailDeliveryError, match="HTTP 503"):
        email.send_identity_email("recipient@example.com", "Reset", "Reset link")

    assert client.request.call_count == 2
    email.time.sleep.assert_called_once_with(1)


def test_brevo_error_includes_safe_provider_code(brevo_connection: MagicMock) -> None:
    client = brevo_connection.return_value
    client.getresponse.return_value.status = 403
    client.getresponse.return_value.read.return_value = (
        b'{"code":"permission_denied","message":"Sensitive details"}'
    )

    with pytest.raises(
        email.EmailDeliveryError,
        match=r"Brevo rejected email \(HTTP 403; code=permission_denied\)",
    ):
        email.send_identity_email("recipient@example.com", "Reset", "Reset link")


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
def test_brevo_rejections_are_not_success(brevo_connection: MagicMock, status: int) -> None:
    client = brevo_connection.return_value
    client.getresponse.return_value.status = status
    with pytest.raises(email.EmailDeliveryError, match=f"HTTP {status}"):
        email.send_identity_email("recipient@example.com", "Reset", "Reset link")
    assert client.request.call_count == 1


@pytest.mark.parametrize(
    "payload",
    [b"invalid", b"{}", b'{"messageId":null}', b'{"messageId":""}', b"[]", b'{"id":"old"}'],
)
def test_brevo_invalid_responses_are_not_success(
    brevo_connection: MagicMock, payload: bytes
) -> None:
    client = brevo_connection.return_value
    client.getresponse.return_value.read.return_value = payload
    with pytest.raises(email.EmailDeliveryError):
        email.send_identity_email("recipient@example.com", "Reset", "Reset link")


def test_brevo_transport_errors_do_not_expose_secrets(brevo_connection: MagicMock) -> None:
    client = brevo_connection.return_value
    client.request.side_effect = OSError("private-test-key")
    with pytest.raises(email.EmailDeliveryError) as caught:
        email.send_identity_email("recipient@example.com", "Reset", "Reset link")
    assert "private-test-key" not in str(caught.value)


async def test_api_failure_becomes_delivery_unavailable(
    brevo_connection: MagicMock,
) -> None:
    client = brevo_connection.return_value
    client.getresponse.return_value.status = 403
    with pytest.raises(APIError) as caught:
        await router._deliver_identity_email("recipient@example.com", "password_reset", "token")
    assert caught.value.status_code == 503


def test_smtp_mode_remains_available(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        _env_file=None,
        mail_provider="smtp",
        mail_username="",
        mail_password="",
        mail_host="localhost",
        mail_port=1025,
        mail_starttls=False,
    )
    monkeypatch.setattr(email, "get_settings", lambda: settings)
    smtp = MagicMock()
    monkeypatch.setattr(email.smtplib, "SMTP", smtp)
    email.send_identity_email("recipient@example.com", "Verify", "Link")
    smtp.assert_called_once_with("localhost", 1025, timeout=10)
    client = smtp.return_value.__enter__.return_value
    client.login.assert_not_called()
    client.starttls.assert_not_called()
    assert client.send_message.call_args.args[0]["To"] == "recipient@example.com"
