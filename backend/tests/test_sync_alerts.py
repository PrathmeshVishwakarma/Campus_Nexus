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
    # cleanup so test runs don't pollute the shared folder
    assert client.delete(f"/api/files/item?path={path}", headers=h).status_code == 200


def test_alerts_ranked_and_ack():
    _, h = _user()
    a = client.post("/api/alerts", json={"title": "Fire drill", "body": "Evacuate B", "priority": "CRITICAL"}, headers=h).json()
    ranked = client.get("/api/alerts/ranked", headers=h).json()
    assert any(x["id"] == a["id"] for x in ranked)
    assert ranked[0]["score"] >= 0
    assert client.post(f"/api/alerts/{a['id']}/ack", json={}, headers=h).json()["ok"] is True
    assert any(r["user"] for r in client.get(f"/api/alerts/{a['id']}/receipts", headers=h).json())


def test_unacked_badge_count_and_top_priority():
    from app.db.models.models import Alert, AlertReceipt
    from app.db.session import SessionLocal

    _, sender_h = _user()          # raises alerts
    _, h = _user()                 # recipient
    created = []
    try:
        for p in ("IMPORTANT", "INFO", "CRITICAL"):
            created.append(client.post("/api/alerts", json={
                "title": f"badge {p}", "body": "b", "priority": p}, headers=sender_h).json()["id"])

        r = client.get("/api/alerts/unacked/count", headers=h).json()
        assert r["count"] == 3
        assert r["priority"] == "CRITICAL"

        client.post(f"/api/alerts/{created[-1]}/ack", json={}, headers=h)
        r = client.get("/api/alerts/unacked/count", headers=h).json()
        assert r["count"] == 2
        assert r["priority"] == "IMPORTANT"
    finally:
        db = SessionLocal()
        try:
            db.query(AlertReceipt).filter(AlertReceipt.alert_id.in_(created)).delete()
            db.query(Alert).filter(Alert.id.in_(created)).delete()
            db.commit()
        finally:
            db.close()


def test_targeted_alert_visibility_and_sender_ack():
    from app.db.models.models import Alert, AlertReceipt
    from app.db.session import SessionLocal

    _, sender_h = _user()
    target, target_h = _user()
    _, outsider_h = _user()
    created = []
    try:
        a = client.post("/api/alerts", json={
            "title": "Targeted", "body": "only target", "priority": "URGENT",
            "target_users": [target]}, headers=sender_h).json()
        created.append(a["id"])

        # target sees it as unacknowledged
        assert any(x["id"] == a["id"] for x in client.get("/api/alerts", headers=target_h).json())
        assert client.get("/api/alerts/unacked/count", headers=target_h).json()["count"] == 1

        # outsider does not see it at all
        assert not any(x["id"] == a["id"] for x in client.get("/api/alerts", headers=outsider_h).json())
        assert client.get("/api/alerts/unacked/count", headers=outsider_h).json()["count"] == 0

        # sender sees their own alert but it is already acknowledged for them
        row = next(x for x in client.get("/api/alerts", headers=sender_h).json() if x["id"] == a["id"])
        assert row["acked_by_me"] is True
        assert client.get("/api/alerts/unacked/count", headers=sender_h).json()["count"] == 0
    finally:
        db = SessionLocal()
        try:
            db.query(AlertReceipt).filter(AlertReceipt.alert_id.in_(created)).delete()
            db.query(Alert).filter(Alert.id.in_(created)).delete()
            db.commit()
        finally:
            db.close()


def test_messages_read_and_graph():
    _, h = _user()
    ch = client.post("/api/messages/channels", json={"name": f"ch_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=h).json()
    m = client.post("/api/messages", json={"channel_id": ch["id"], "content": "hi"}, headers=h).json()
    assert client.patch(f"/api/messages/{m['id']}/read", headers=h).json()["ok"] is True
    assert client.post("/api/peers/heartbeat", json={"hostname": "testnode", "ip": "127.0.0.1"}).json()["ok"] is True
    g = client.get("/api/network/graph", headers=h).json()
    assert "server" in [n["id"] for n in g["nodes"]]
    assert client.get("/api/network/stats", headers=h).json()["throttle"]["bps"] >= 0
