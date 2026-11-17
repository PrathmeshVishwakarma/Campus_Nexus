import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _user():
    u = f"p_{uuid.uuid4().hex[:6]}"
    assert client.post("/api/auth/register",
                       json={"username": u, "email": f"{u}@x.com", "password": "pass123"}).status_code == 200
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"}).json()["access_token"]
    return u, {"Authorization": f"Bearer {t}"}


def test_vapid_public_key_and_subscription_roundtrip():
    _, h = _user()
    key = client.get("/api/push/public-key")
    assert key.status_code == 200
    assert len(key.json()["key"]) > 40

    endpoint = f"https://push.example.com/{uuid.uuid4().hex}"
    body = {"endpoint": endpoint, "keys": {"p256dh": "B" * 87, "auth": "A" * 22}}
    assert client.post("/api/push/subscribe", json=body, headers=h).json()["ok"] is True
    # upsert is idempotent
    assert client.post("/api/push/subscribe", json=body, headers=h).json()["ok"] is True
    assert client.delete("/api/push/subscribe", params={"endpoint": endpoint},
                         headers=h).json()["ok"] is True
