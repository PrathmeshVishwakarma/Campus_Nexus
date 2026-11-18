"""Features merged from the team branch plus the settings that govern them."""
import io
import uuid
from datetime import datetime, timedelta

from conftest import make_user


def _put(client, h, path, data=b"x"):
    uid = uuid.uuid4().hex
    r = client.post(f"/api/sync/chunk?path={path}&index=0&total=1&upload_id={uid}",
                    files={"file": ("f", io.BytesIO(data), "text/plain")}, headers=h)
    if r.status_code != 200:
        return r
    return client.post(f"/api/sync/complete?path={path}&upload_id={uid}", json={"size": len(data)}, headers=h)


def test_leave_group_keeps_it_for_others(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    g = client.post("/api/messages/channels", json={"name": f"l_{uuid.uuid4().hex[:6]}", "members": [b]},
                    headers=ha).json()
    r = client.post(f"/api/messages/channels/{g['id']}/members", json={"remove": [b]}, headers=hb)
    assert r.status_code == 200 and b not in r.json()["members"]
    assert g["id"] not in [c["id"] for c in client.get("/api/messages/channels", headers=hb).json()]
    assert g["id"] in [c["id"] for c in client.get("/api/messages/channels", headers=ha).json()]


def test_view_only_members_can_read_but_not_write(client):
    a, ha, _ = make_user(client)
    v, hv, _ = make_user(client)
    sub = f"ro_{uuid.uuid4().hex[:6]}"
    assert _put(client, ha, f"{sub}/doc.txt", b"original").status_code == 200
    r = client.post(f"/api/files/folders?subfolder={sub}", json={"members": [a, v], "viewers": [v]}, headers=ha)
    assert r.status_code == 200 and r.json()["viewers"] == [v]
    assert client.get(f"/api/files/download?path={sub}/doc.txt", headers=hv).content == b"original"
    assert _put(client, hv, f"{sub}/doc.txt", b"changed").status_code == 403
    assert client.delete(f"/api/files/item?path={sub}/doc.txt", headers=hv).status_code == 403
    assert client.post(f"/api/files/resolve?path={sub}/doc.txt&strategy=latest", headers=hv).status_code == 403
    folder = [f for f in client.get("/api/files/folders", headers=hv).json() if f["name"] == sub][0]
    assert folder["can_edit"] is False
    # the owner can still write
    assert _put(client, ha, f"{sub}/doc.txt", b"v2").status_code == 200


def test_alert_target_users_compat_and_unacked_badge(client, admin):
    _, ah, _ = admin
    t, ht, _ = make_user(client)
    o, ho, _ = make_user(client)
    a = client.post("/api/alerts", json={"title": "for t", "priority": "URGENT", "target_users": [t]},
                    headers=ah).json()
    assert a["target_scope"] == f"users:{t}"
    c = client.get("/api/alerts/unacked/count", headers=ht).json()
    assert c["count"] == 1 and c["priority"] == "URGENT"
    assert client.get("/api/alerts/unacked/count", headers=ho).json()["count"] == 0
    # sender is not counted as a recipient who acknowledged
    rec = client.get(f"/api/alerts/{a['id']}/receipts", headers=ah).json()
    assert [r["user"] for r in rec] == [t]
    client.post(f"/api/alerts/{a['id']}/ack", headers=ht)
    assert client.get("/api/alerts/unacked/count", headers=ht).json()["count"] == 0


def test_min_priority_applies_to_badges_and_rank(client, admin):
    _, ah, _ = admin
    u, h, _ = make_user(client)
    client.patch("/api/notifications/settings", json={"min_alert_priority": "URGENT"}, headers=h)
    lo = client.post("/api/alerts", json={"title": "lo", "priority": "INFO", "target_users": [u]}, headers=ah).json()
    hi = client.post("/api/alerts", json={"title": "hi", "priority": "URGENT", "target_users": [u]}, headers=ah).json()
    assert client.get("/api/alerts/unacked/count", headers=h).json()["count"] == 1
    b = client.get("/api/notifications/badges", headers=h).json()
    assert b["alerts"] == 1 and b["alert_priority"] == "URGENT"
    ranked = client.get("/api/alerts/ranked", headers=h).json()
    ids = [x["id"] for x in ranked]
    assert ids.index(hi["id"]) < ids.index(lo["id"])
    assert [x for x in ranked if x["id"] == lo["id"]][0]["below_threshold"] is True
    # turning badges off zeroes the counts
    client.patch("/api/notifications/settings", json={"badges": False}, headers=h)
    assert client.get("/api/notifications/badges", headers=h).json() == {
        "chat": 0, "alerts": 0, "alert_priority": None, "enabled": False}


def test_muted_channel_excluded_from_chat_badge(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    g1 = client.post("/api/messages/channels", json={"name": f"m1_{uuid.uuid4().hex[:6]}", "members": [b]},
                     headers=ha).json()
    g2 = client.post("/api/messages/channels", json={"name": f"m2_{uuid.uuid4().hex[:6]}", "members": [b]},
                     headers=ha).json()
    for g in (g1, g2):
        client.post("/api/messages", json={"channel_id": g["id"], "content": "hi"}, headers=ha)
    assert client.get("/api/notifications/badges", headers=hb).json()["chat"] == 2
    client.patch("/api/notifications/settings", json={"mute_channel_ids": [g1["id"]]}, headers=hb)
    assert client.get("/api/notifications/badges", headers=hb).json()["chat"] == 1
    chans = {c["id"]: c for c in client.get("/api/messages/channels", headers=hb).json()}
    assert chans[g1["id"]]["muted"] is True and chans[g1["id"]]["unread"] == 1   # still listed


def test_dnd_holds_instead_of_dropping():
    from app.services.notify import decide

    class P:
        enabled = True; enable_messages = True; enable_file_events = True; enable_alerts = True
        min_alert_priority = "INFO"; mute_channel_ids = []; mute_folder_paths = []
        dnd_start = "22:00"; dnd_end = "07:00"; sound = True; desktop_toast = True; badges = True

    night = datetime(2026, 1, 1, 23, 30)
    day = night + timedelta(hours=12)
    msg = {"channel_id": 1, "text": "hi"}
    assert decide(P, "MESSAGE_SENT", "x", "me", "channel:1", msg, night) == "held"
    assert decide(P, "MESSAGE_SENT", "x", "me", "channel:1", msg, day) == "notify"
    assert decide(P, "ALERT_CREATED", "x", "me", "a", {"priority": "NORMAL"}, night) == "held"
    assert decide(P, "ALERT_CREATED", "x", "me", "a", {"priority": "CRITICAL"}, night) == "notify"
    P.mute_channel_ids = [1]
    assert decide(P, "MESSAGE_SENT", "x", "me", "channel:1", msg, night) == "skip"


def test_push_subscription_requires_https(client, user):
    _, h, _ = user
    bad = {"endpoint": "http://evil.example/x", "keys": {"p256dh": "B" * 87, "auth": "A" * 22}}
    assert client.post("/api/push/subscribe", json=bad, headers=h).status_code == 422
    assert client.post("/api/push/subscribe", json=bad).status_code == 401
