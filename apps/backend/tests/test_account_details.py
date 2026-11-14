from io import BytesIO
from uuid import UUID

import pytest
from PIL import Image
from sqlalchemy import select
from test_identity import IdentityClient, _register_and_verify, identity_client

from app.catalog.models import Shop
from app.identity import account_details
from app.identity.models import AccountDetails, PlatformOwner, VendorProfile

__all__ = ["identity_client"]

PATH = "/api/v1/me/account-details"


async def _login(client, emails, factory):
    await _register_and_verify(client, emails, "settings@example.com")
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "settings@example.com", "password": "a-correct-horse-battery-staple"},
    )
    user_id = UUID(response.json()["id"])
    async with factory() as session:
        session.add(VendorProfile(user_id=user_id, business_name="Approved business"))
        session.add(PlatformOwner(user_id=user_id))
        await session.commit()
    return user_id


async def test_settings_isolation_persistence_and_legacy_coherence(identity_client: IdentityClient):
    client, emails, factory = identity_client
    user_id = await _login(client, emails, factory)
    original = (await client.get(PATH)).json()
    assert (original["first_name"], original["last_name"]) == ("Test Customer", "")
    assert original["email_verified"] and original["business_name"] is None
    assert (await client.patch(PATH, json={"business_category": None})).status_code == 403
    assert (await client.patch(PATH, json={"email": "other@example.com"})).status_code == 422
    assert (await client.patch(PATH, json={"communication_email": None})).status_code == 422
    assert (await client.patch(PATH, json={"communication_email": "true"})).status_code == 422
    assert (await client.patch(PATH, json={"first_name": "  "})).status_code == 422
    assert (
        await client.patch(PATH, json={"first_name": "a" * 60, "last_name": "b" * 60})
    ).status_code == 422
    response = await client.patch(
        PATH,
        json={
            "first_name": "Asha",
            "last_name": "Thapa",
            "phone": " 123 ",
            "preferred_categories": [" Books "],
            "communication_email": True,
            "communication_sms": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["preferred_categories"] == ["Books"]
    profile = (await client.get("/api/v1/me")).json()["profile"]
    assert profile == {"full_name": "Asha Thapa", "phone": "123"}
    client.headers["X-VMarket-Workspace"] = "vendor"
    assert (await client.patch(PATH, json={"preferred_categories": []})).status_code == 403
    assert (await client.patch(PATH, json={"payout_preference": "wallet"})).status_code == 422
    vendor = await client.patch(
        PATH,
        json={
            "business_category": "retail",
            "registration_number": "PAN-1",
            "payout_preference": "bank_transfer",
            "business_description": "x" * 1000,
        },
    )
    assert vendor.status_code == 200, vendor.text
    assert vendor.json()["business_name"] == "Approved business"
    assert vendor.json()["business_description"] == "x" * 1000
    assert vendor.json()["preferred_categories"] == []
    assert vendor.json()["first_name"] == "Asha"
    shared = await client.patch(
        PATH, json={"first_name": "Mina", "last_name": "Rai", "phone": "456"}
    )
    assert shared.status_code == 200
    assert (await client.get("/api/v1/me")).json()["profile"] == {
        "full_name": "Mina Rai",
        "phone": "456",
    }
    client.headers["X-VMarket-Workspace"] = "customer"
    customer = (await client.get(PATH)).json()
    assert (customer["first_name"], customer["last_name"], customer["phone"]) == (
        "Mina",
        "Rai",
        "456",
    )
    assert customer["business_category"] is None and customer["registration_number"] is None
    assert customer["preferred_categories"] == ["Books"]
    legacy = await client.patch(
        "/api/v1/me", json={"full_name": "Name With Many Parts", "phone": "789"}
    )
    assert legacy.status_code == 200
    current = (await client.get(PATH)).json()
    assert (current["first_name"], current["last_name"], current["phone"]) == (
        "Name With Many Parts",
        "",
        "789",
    )
    async with factory() as session:
        row = await session.get(AccountDetails, user_id)
        assert row and row.payout_preference == "bank_transfer"
    client.headers["X-VMarket-Workspace"] = "admin"
    assert (await client.get(PATH)).status_code == 403
    client.headers.pop("X-VMarket-Workspace")
    assert (await client.get(PATH)).status_code == 422


class FakeStorage:
    def __init__(self):
        self.objects = {}

    def put_object(self, bucket, key, stream, length, content_type):
        self.objects[key] = stream.read(length)

    def remove_object(self, bucket, key):
        self.objects.pop(key, None)

    def get_object(self, bucket, key):
        class Object(BytesIO):
            def release_conn(self):
                pass

        return Object(self.objects[key])


def _image(fmt: str) -> bytes:
    stream = BytesIO()
    Image.new("RGB", (2, 2), "red").save(stream, format=fmt)
    return stream.getvalue()


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
async def test_avatar_validates_content_and_deletes(
    identity_client: IdentityClient, monkeypatch: pytest.MonkeyPatch, fmt: str
):
    client, emails, factory = identity_client
    await _login(client, emails, factory)
    storage = FakeStorage()
    monkeypatch.setattr(account_details, "get_minio_client", lambda: storage)
    assert (
        await client.post(PATH + "/avatar", files={"file": ("x.svg", b"<svg/>", "image/png")})
    ).status_code == 415
    assert (
        await client.post(
            PATH + "/avatar", files={"file": ("x.png", b"\x89PNG\r\n\x1a\n", "image/png")}
        )
    ).status_code == 415
    assert (
        await client.post(
            PATH + "/avatar", files={"file": ("x", b"a" * (2 * 1024 * 1024 + 1), "image/png")}
        )
    ).status_code == 413
    data = _image(fmt)
    result = await client.post(PATH + "/avatar", files={"file": ("x", data, "text/plain")})
    assert result.status_code == 200, result.text
    url = result.json()["avatar_url"]
    assert url == "/api/v1/me/account-details/avatar/content"
    assert (await client.get(PATH)).json()["avatar_url"] == url
    image = await client.get(url)
    assert image.content == data and image.headers["cache-control"] == "private, no-store"
    await client.post("/api/v1/auth/logout")
    assert (await client.get(url)).status_code == 401
    await _register_and_verify(client, emails, "other@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={"email": "other@example.com", "password": "a-correct-horse-battery-staple"},
    )
    assert (await client.get(url)).status_code == 404
    await client.post("/api/v1/auth/logout")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "settings@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert len(storage.objects) == 1
    replacement = await client.post(PATH + "/avatar", files={"file": ("x", data, "text/plain")})
    assert replacement.status_code == 200 and len(storage.objects) == 1
    deleted = await client.delete(PATH + "/avatar")
    assert deleted.json()["avatar_url"] is None and not storage.objects
    assert (await client.get(url)).status_code == 404


async def test_account_settings_export_is_workspace_scoped(
    identity_client: IdentityClient, monkeypatch: pytest.MonkeyPatch
):
    client, emails, factory = identity_client
    user_id = await _login(client, emails, factory)
    monkeypatch.setattr(account_details, "get_minio_client", lambda: FakeStorage())
    async with factory() as session:
        shop = Shop(
            slot=1,
            owner_user_id=user_id,
            name="My shop",
            slug="account-export-shop",
            city="Kathmandu",
            province="Bagmati",
        )
        session.add(shop)
        await session.commit()
        shop_id = str(shop.id)
    assert (
        await client.patch(
            PATH,
            json={
                "first_name": "Asha",
                "last_name": "Rai",
                "preferred_categories": ["books"],
                "communication_email": True,
            },
        )
    ).status_code == 200
    assert (
        await client.post(PATH + "/avatar", files={"file": ("avatar", _image("PNG"), "image/png")})
    ).status_code == 200
    client.headers["X-VMarket-Workspace"] = "vendor"
    assert (
        await client.patch(
            PATH,
            json={
                "business_category": "retail",
                "registration_number": "PAN-1",
                "payout_preference": "manual",
                "business_description": "Local",
            },
        )
    ).status_code == 200
    assert (await client.get("/api/v1/me/export")).status_code == 422
    client.headers["X-VMarket-Shop-Id"] = shop_id
    exported = await client.get("/api/v1/me/export")
    assert exported.status_code == 200
    vendor = exported.json()["account_settings"]
    assert vendor == {
        "first_name": "Asha",
        "last_name": "Rai",
        "phone": None,
        "avatar_url": "/api/v1/me/account-details/avatar/content",
        "communication_email": True,
        "communication_sms": False,
        "business_name": "Approved business",
        "business_category": "retail",
        "registration_number": "PAN-1",
        "payout_preference": "manual",
        "business_description": "Local",
    }
    client.headers.pop("X-VMarket-Shop-Id")
    client.headers["X-VMarket-Workspace"] = "customer"
    exported = await client.get("/api/v1/me/export")
    assert exported.status_code == 200
    assert exported.json()["account_settings"] == {
        "first_name": "Asha",
        "last_name": "Rai",
        "phone": None,
        "avatar_url": "/api/v1/me/account-details/avatar/content",
        "communication_email": True,
        "communication_sms": False,
        "preferred_categories": ["books"],
    }
    client.headers["X-VMarket-Workspace"] = "admin"
    assert "account_settings" not in (await client.get("/api/v1/me/export")).json()


async def test_unauthorized_workspace_and_phone_conflict(identity_client: IdentityClient):
    client, emails, factory = identity_client
    await _register_and_verify(client, emails, "one@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "one@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert (await client.patch(PATH, json={"phone": "123"})).status_code == 200
    await client.post("/api/v1/auth/logout")
    await _register_and_verify(client, emails, "two@example.com")
    await client.post(
        "/api/v1/auth/login",
        json={
            "email": "two@example.com",
            "password": "a-correct-horse-battery-staple",
        },
    )
    assert (await client.patch(PATH, json={"phone": "123"})).status_code == 409
    client.headers["X-VMarket-Workspace"] = "vendor"
    assert (await client.get(PATH)).status_code == 403
    async with factory() as session:
        assert len(list((await session.scalars(select(AccountDetails))).all())) == 1
