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


def test_channel_rename_unique_add_remove_delete():
    _, h = _user()
    a = client.post("/api/messages/channels", json={"name": f"a_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=h).json()
    b = client.post("/api/messages/channels", json={"name": f"b_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=h).json()

    # rename onto existing name -> 400, nothing changed
    r = client.patch(f"/api/messages/channels/{a['id']}", json={"name": b["name"]}, headers=h)
    assert r.status_code == 400

    # valid rename
    new_name = f"renamed_{uuid.uuid4().hex[:6]}"
    r = client.patch(f"/api/messages/channels/{a['id']}", json={"name": new_name}, headers=h)
    assert r.status_code == 200 and r.json()["name"] == new_name

    # add unknown user -> 400
    r = client.post(f"/api/messages/channels/{a['id']}/members", json={"add": ["no_such_user"]}, headers=h)
    assert r.status_code == 400

    # remove self -> 400
    me = client.get("/api/auth/me", headers=h).json()["username"]
    r = client.post(f"/api/messages/channels/{a['id']}/members", json={"remove": [me]}, headers=h)
    assert r.status_code == 400

    # delete with messages
    client.post("/api/messages", json={"channel_id": b["id"], "content": "bye"}, headers=h)
    r = client.delete(f"/api/messages/channels/{b['id']}", headers=h)
    assert r.status_code == 200 and r.json()["deleted_messages"] == 1
    ids = [c["id"] for c in client.get("/api/messages/channels", headers=h).json()]
    assert b["id"] not in ids
