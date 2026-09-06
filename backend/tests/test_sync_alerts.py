import io
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _user():
    u = f"u_{uuid.uuid4().hex[:6]}"
    assert client.post("/api/auth/register",
                       json={"username": u, "email": f"{u}@x.com", "password": "pass123"}).status_code == 200
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"}).json()["access_token"]
    return u, {"Authorization": f"Bearer {t}"}


def test_chunk_sync_version_conflict_flow():
    _, h = _user()
    path = f"t_{uuid.uuid4().hex[:6]}.txt"
    files = {"file": ("f.txt", io.BytesIO(b"hello campus"), "text/plain")}
    assert client.post(f"/api/sync/chunk?path={path}&index=0&total=1", files=files, headers=h).status_code == 200
    done = client.post(f"/api/sync/complete?path={path}", json={}, headers=h).json()
    assert done["version"] == 1
    # identical re-upload => deduped
    assert client.post(f"/api/sync/chunk?path={path}&index=0&total=1", files=files, headers=h).status_code == 200
    assert client.post(f"/api/sync/complete?path={path}", json={}, headers=h).json().get("deduped") is True
    # manifest + download + resolve
    assert client.get(f"/api/sync/manifest?path={path}", headers=h).json()["exists"] is True
    assert client.get(f"/api/files/download?path={path}", headers=h).status_code == 200
    assert client.post(f"/api/files/resolve?path={path}&strategy=latest", json={}, headers=h).json()["ok"] is True


def test_alerts_ranked_and_ack():
    _, h = _user()
    a = client.post("/api/alerts", json={"title": "Fire drill", "body": "Evacuate B", "priority": "CRITICAL"}, headers=h).json()
    ranked = client.get("/api/alerts/ranked", headers=h).json()
    assert any(x["id"] == a["id"] for x in ranked)
    assert ranked[0]["score"] >= 0
    assert client.post(f"/api/alerts/{a['id']}/ack", json={}, headers=h).json()["ok"] is True
    assert any(r["user"] for r in client.get(f"/api/alerts/{a['id']}/receipts", headers=h).json())


def test_messages_read_and_graph():
    _, h = _user()
    ch = client.post("/api/messages/channels", json={"name": "t", "type": "group"}, headers=h).json()
    m = client.post("/api/messages", json={"channel_id": ch["id"], "content": "hi"}, headers=h).json()
    assert client.patch(f"/api/messages/{m['id']}/read", headers=h).json()["ok"] is True
    assert client.post("/api/peers/heartbeat", json={"hostname": "testnode", "ip": "127.0.0.1"}).json()["ok"] is True
    g = client.get("/api/network/graph", headers=h).json()
    assert "server" in [n["id"] for n in g["nodes"]]
    assert client.get("/api/network/stats", headers=h).json()["throttle"]["bps"] >= 0
