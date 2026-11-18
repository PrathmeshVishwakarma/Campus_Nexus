import io
import uuid

from conftest import make_user


def _upload(client, h, path, data: bytes, chunk=1_048_576, base_version=None, upload_id=None):
    upload_id = upload_id or uuid.uuid4().hex
    total = max(1, -(-len(data) // chunk))
    for i in range(total):
        piece = data[i * chunk:(i + 1) * chunk]
        r = client.post(f"/api/sync/chunk?path={path}&index={i}&total={total}&upload_id={upload_id}",
                        files={"file": ("f", io.BytesIO(piece), "application/octet-stream")}, headers=h)
        assert r.status_code == 200, r.text
    body = {"size": len(data)}
    if base_version is not None:
        body["base_version"] = base_version
    return client.post(f"/api/sync/complete?path={path}&upload_id={upload_id}", json=body, headers=h)


def test_chunk_sync_version_conflict_flow(client, user):
    _, h, _ = user
    path = f"t_{uuid.uuid4().hex[:6]}.txt"
    done = _upload(client, h, path, b"hello campus").json()
    assert done["version"] == 1
    assert _upload(client, h, path, b"hello campus").json().get("deduped") is True
    assert client.get(f"/api/sync/manifest?path={path}", headers=h).json()["exists"] is True
    r = client.get(f"/api/files/download?path={path}", headers=h)
    assert r.status_code == 200 and r.content == b"hello campus"
    assert client.post(f"/api/files/resolve?path={path}&strategy=latest", headers=h).json()["ok"] is True
    assert client.delete(f"/api/files/item?path={path}", headers=h).status_code == 200


def test_multichunk_upload_is_byte_exact(client, user, tmp_root):
    """Regression: chunks used to be written twice (immediately + via scheduler)."""
    _, h, _ = user
    path = f"big_{uuid.uuid4().hex[:6]}.bin"
    data = bytes(range(256)) * 9000          # ~2.3 MB -> 3 chunks
    assert _upload(client, h, path, data).json()["version"] == 1
    assert (tmp_root / path).read_bytes() == data
    # change only the middle chunk; client skips unchanged chunks (dedup)
    data2 = bytearray(data)
    data2[1_048_576 + 10] ^= 0xFF
    man = client.get(f"/api/sync/manifest?path={path}", headers=h).json()
    uid = uuid.uuid4().hex
    import hashlib
    for i, c in enumerate(man["chunks"]):
        piece = bytes(data2[i * 1_048_576:(i + 1) * 1_048_576])
        if hashlib.sha256(piece).hexdigest() == c["hash"]:
            continue
        client.post(f"/api/sync/chunk?path={path}&index={i}&total=3&upload_id={uid}",
                    files={"file": ("f", io.BytesIO(piece), "application/octet-stream")}, headers=h)
    done = client.post(f"/api/sync/complete?path={path}&upload_id={uid}",
                       json={"size": len(data2), "base_version": 1}, headers=h).json()
    assert done["version"] == 2 and done["conflict"] is False
    assert (tmp_root / path).read_bytes() == bytes(data2)
    # shrinking a file truncates correctly
    assert _upload(client, h, path, b"short", base_version=2).json()["version"] == 3
    assert (tmp_root / path).read_bytes() == b"short"


def test_conflict_only_for_concurrent_edits_and_restore(client, tmp_root):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    path = f"doc_{uuid.uuid4().hex[:6]}.txt"
    assert _upload(client, ha, path, b"v1 by a").json()["version"] == 1
    # b edits on top of v1: sequential, different user -> no conflict
    r = _upload(client, hb, path, b"v2 by b", base_version=1).json()
    assert r["version"] == 2 and r["conflict"] is False
    # a still has v1 and uploads -> concurrent -> conflict
    r = _upload(client, ha, path, b"v3 by a (from v1)", base_version=1).json()
    assert r["conflict"] is True and r["version"] == 3
    # restore b's version: content really comes back
    r = client.post(f"/api/files/resolve?path={path}&strategy=version&version=2", headers=ha).json()
    assert r["restored"] is True and r["version"] == 4
    assert (tmp_root / path).read_bytes() == b"v2 by b"
    r = client.post(f"/api/files/resolve?path={path}&strategy=keep-mine", headers=ha).json()
    assert (tmp_root / path).read_bytes() == b"v3 by a (from v1)" and r["restored"] is True
    assert client.get(f"/api/files/download?path={path}&version=1", headers=hb).content == b"v1 by a"


def test_download_chunk_size_is_capped(client, user):
    _, h, _ = user
    path = f"c_{uuid.uuid4().hex[:6]}.txt"
    _upload(client, h, path, b"abc")
    assert client.get(f"/api/sync/download?path={path}&chunk_size=999999999", headers=h).status_code == 422
    assert client.get(f"/api/sync/download?path={path}&index=-1", headers=h).status_code == 422


def test_alerts_ranked_and_ack(client, admin):
    _, h, _ = admin
    a = client.post("/api/alerts", json={"title": "Fire drill", "body": "Evacuate B", "priority": "CRITICAL"},
                    headers=h).json()
    ranked = client.get("/api/alerts/ranked", headers=h).json()
    assert any(x["id"] == a["id"] for x in ranked)
    assert 0 <= ranked[0]["score"] <= 100
    assert client.post(f"/api/alerts/{a['id']}/ack", headers=h).json()["ok"] is True
    assert any(r["user"] for r in client.get(f"/api/alerts/{a['id']}/receipts", headers=h).json())


def test_alert_priority_roles_and_scope(client, admin):
    s, hs, _ = make_user(client)
    t, ht, _ = make_user(client)
    o, ho, _ = make_user(client)
    assert client.post("/api/alerts", json={"title": "x", "priority": "CRITICAL"}, headers=hs).status_code == 403
    assert client.post("/api/alerts", json={"title": "x", "priority": "BOGUS"}, headers=hs).status_code == 422
    a = client.post("/api/alerts", json={"title": "for t", "priority": "NORMAL", "target_scope": f"users:{t}"},
                    headers=hs).json()
    assert a["id"] in [x["id"] for x in client.get("/api/alerts", headers=ht).json()]
    assert a["id"] not in [x["id"] for x in client.get("/api/alerts", headers=ho).json()]
    assert client.post(f"/api/alerts/{a['id']}/ack", headers=ho).status_code == 404
    assert client.get(f"/api/alerts/{a['id']}/receipts", headers=ho).status_code == 404
    # acking over the socket acks the caller's own receipt only
    tok_t = client.post("/api/auth/login", data={"username": t, "password": "pass123"}).json()["access_token"]
    with client.websocket_connect(f"/ws/events?token={tok_t}") as ws:
        ws.send_json({"action": "ACK_ALERT", "alert_id": a["id"]})
        ws.send_json({"action": "PING"})
        while ws.receive_json()["event"] != "PONG":
            pass
    rec = {r["user"]: r for r in client.get(f"/api/alerts/{a['id']}/receipts", headers=hs).json()}
    assert rec[t]["acked_at"] is not None


def test_messages_read_and_graph(client, user):
    _, h, _ = user
    ch = client.post("/api/messages/channels", json={"name": f"ch_{uuid.uuid4().hex[:6]}", "type": "group"},
                     headers=h).json()
    m = client.post("/api/messages", json={"channel_id": ch["id"], "content": "hi"}, headers=h).json()
    assert client.patch(f"/api/messages/{m['id']}/read", headers=h).json()["ok"] is True
    assert client.post("/api/peers/heartbeat", json={"hostname": "testnode", "ip": "10.0.0.5"}).status_code == 401
    assert client.post("/api/peers/heartbeat", json={"hostname": "testnode", "ip": "10.0.0.5"},
                       headers=h).json()["ok"] is True
    g = client.get("/api/network/graph", headers=h).json()
    assert "server" in [n["id"] for n in g["nodes"]]
    assert client.get("/api/network/stats", headers=h).json()["throttle"]["bps"] >= 0


def test_scheduler_controls_are_admin_only(client, user, admin):
    _, h, _ = user
    _, ah, _ = admin
    assert client.post("/api/sync/report-activity?n_modified=5000", headers=h).status_code == 403
    assert client.post("/api/sync/resume-scheduler", headers=h).status_code == 403
    assert client.post("/api/sync/report-activity?n_modified=5000", headers=ah).json()["anomaly"] is True
    # while paused, uploads are refused instead of half-applied
    r = client.post("/api/sync/chunk?path=p.txt&index=0&total=1",
                    files={"file": ("f", io.BytesIO(b"x"), "text/plain")}, headers=h)
    assert r.status_code == 423
    assert client.post("/api/sync/resume-scheduler", headers=ah).json()["ok"] is True
