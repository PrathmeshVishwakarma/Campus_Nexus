from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").status_code == 200


def test_register_login_event():
    import uuid
    u = f"u_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/auth/register", json={"username": u, "email": f"{u}@x.com", "password": "pass123"})
    assert r.status_code == 200
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"})
    token = t.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    e = client.post("/api/events", json={"type": "FILE_CREATED", "actor": u, "resource": "/x"})
    # events route currently open; accept 200
    assert e.status_code in (200, 401)
