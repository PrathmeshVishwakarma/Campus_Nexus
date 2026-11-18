import uuid

from conftest import make_user


def test_channel_rename_unique_add_remove_delete(client, user):
    _, h, _ = user
    a = client.post("/api/messages/channels", json={"name": f"a_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=h).json()
    b = client.post("/api/messages/channels", json={"name": f"b_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=h).json()

    r = client.patch(f"/api/messages/channels/{a['id']}", json={"name": b["name"]}, headers=h)
    assert r.status_code == 400

    new_name = f"renamed_{uuid.uuid4().hex[:6]}"
    r = client.patch(f"/api/messages/channels/{a['id']}", json={"name": new_name}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == new_name

    r = client.post(f"/api/messages/channels/{a['id']}/members", json={"add": ["no_such_user"]}, headers=h)
    assert r.status_code == 400

    me = client.get("/api/auth/me", headers=h).json()["username"]
    r = client.post(f"/api/messages/channels/{a['id']}/members", json={"remove": [me]}, headers=h)
    assert r.status_code == 400

    client.post("/api/messages", json={"channel_id": b["id"], "content": "bye"}, headers=h)
    r = client.delete(f"/api/messages/channels/{b['id']}", headers=h)
    assert r.status_code == 200 and r.json()["deleted_messages"] == 1
    ids = [c["id"] for c in client.get("/api/messages/channels", headers=h).json()]
    assert b["id"] not in ids


def test_channel_privacy_and_permissions(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    out, ho, _ = make_user(client)
    g = client.post("/api/messages/channels", json={"name": f"g_{uuid.uuid4().hex[:6]}", "members": [b]},
                    headers=ha).json()
    client.post("/api/messages", json={"channel_id": g["id"], "content": "hi"}, headers=ha)
    # outsiders cannot list, read, post, mark read, type or delete
    assert g["id"] not in [c["id"] for c in client.get("/api/messages/channels", headers=ho).json()]
    assert client.get(f"/api/messages?channel_id={g['id']}", headers=ho).status_code == 404
    assert client.post("/api/messages", json={"channel_id": g["id"], "content": "x"}, headers=ho).status_code == 404
    assert client.post(f"/api/messages/typing?channel_id={g['id']}", headers=ho).status_code == 404
    assert client.delete(f"/api/messages/channels/{g['id']}", headers=ho).status_code == 404
    # a non-creator member cannot delete the group or kick others
    assert client.delete(f"/api/messages/channels/{g['id']}", headers=hb).status_code == 403
    assert client.post(f"/api/messages/channels/{g['id']}/members", json={"remove": [a]},
                       headers=hb).status_code == 403
    # 'file' channels cannot be created by clients
    assert client.post("/api/messages/channels", json={"name": "f", "type": "file"}, headers=ha).status_code == 400


def test_per_user_read_receipts(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    c, hc, _ = make_user(client)
    g = client.post("/api/messages/channels", json={"name": f"r_{uuid.uuid4().hex[:6]}", "members": [b, c]},
                    headers=ha).json()
    m = client.post("/api/messages", json={"channel_id": g["id"], "content": "hello"}, headers=ha).json()
    assert client.get(f"/api/messages/unread/count?channel_id={g['id']}", headers=hb).json()["unread"] == 1
    assert client.post(f"/api/messages/read?channel_id={g['id']}", headers=hb).json()["marked"] == 1
    # b reading does not mark it read for c
    assert client.get(f"/api/messages/unread/count?channel_id={g['id']}", headers=hc).json()["unread"] == 1
    mine = client.get(f"/api/messages?channel_id={g['id']}", headers=ha).json()[0]
    assert mine["id"] == m["id"] and mine["read_by"] == [b] and mine["read"] is True and not mine["read_by_all"]
    ch = [x for x in client.get("/api/messages/channels", headers=hc).json() if x["id"] == g["id"]][0]
    assert ch["unread"] == 1


def test_dm_is_unique_per_pair(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    d1 = client.post("/api/messages/channels", json={"name": "chat", "type": "dm", "members": [b]}, headers=ha).json()
    d2 = client.post("/api/messages/channels", json={"name": "chat", "type": "dm", "members": [a]}, headers=hb).json()
    assert d1["id"] == d2["id"]
    assert client.post("/api/messages/channels", json={"name": "x", "type": "dm", "members": []},
                       headers=ha).status_code == 400
