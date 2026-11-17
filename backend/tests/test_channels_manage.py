import uuid

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.models.models import User
from app.db.session import SessionLocal
from app.main import app

client = TestClient(app)


def _user():
    u = f"u_{uuid.uuid4().hex[:6]}"
    assert client.post("/api/auth/register",
                       json={"username": u, "email": f"{u}@x.com", "password": "pass123"}).status_code == 200
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"}).json()["access_token"]
    return u, {"Authorization": f"Bearer {t}"}


def _admin():
    u = f"adm_{uuid.uuid4().hex[:6]}"
    db = SessionLocal()
    try:
        db.add(User(username=u, email=f"{u}@x.com",
                    hashed_password=hash_password("pass123"), role="admin"))
        db.commit()
    finally:
        db.close()
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"}).json()["access_token"]
    return u, {"Authorization": f"Bearer {t}"}


def test_channel_rename_unique_add_remove_delete():
    me, h = _user()
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

    # a member can leave (remove self) and then no longer sees the channel
    r = client.post(f"/api/messages/channels/{a['id']}/members", json={"remove": [me]}, headers=h)
    assert r.status_code == 200 and me not in r.json()["members"]
    ids = [c["id"] for c in client.get("/api/messages/channels", headers=h).json()]
    assert a["id"] not in ids

    # non-members cannot read or post to a channel they are not part of
    _, other = _user()
    c = client.post("/api/messages/channels", json={"name": f"c_{uuid.uuid4().hex[:6]}", "type": "group"}, headers=other).json()
    assert client.get(f"/api/messages?channel_id={c['id']}", headers=h).status_code == 403
    assert client.post("/api/messages", json={"channel_id": c["id"], "content": "hi"}, headers=h).status_code == 403
    assert c["id"] not in [x["id"] for x in client.get("/api/messages/channels", headers=h).json()]

    # only admins may delete a channel
    client.post("/api/messages", json={"channel_id": b["id"], "content": "bye"}, headers=h)
    assert client.delete(f"/api/messages/channels/{b['id']}", headers=h).status_code == 403
    _, admin = _admin()
    r = client.delete(f"/api/messages/channels/{b['id']}", headers=admin)
    assert r.status_code == 200 and r.json()["deleted_messages"] == 1
    ids = [c["id"] for c in client.get("/api/messages/channels", headers=h).json()]
    assert b["id"] not in ids


def test_registration_cannot_self_promote():
    u = f"u_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/auth/register",
                    json={"username": u, "email": f"{u}@x.com", "password": "pass123",
                          "role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "student"

    _, h = _user()
    other = f"u_{uuid.uuid4().hex[:6]}"
    client.post("/api/auth/register", json={"username": other, "email": f"{other}@x.com",
                                            "password": "pass123"})
    assert client.patch(f"/api/auth/users/{other}/role", json={"role": "admin"},
                        headers=h).status_code == 403


def test_admin_can_promote_and_demote():
    _, admin = _admin()
    target = f"u_{uuid.uuid4().hex[:6]}"
    client.post("/api/auth/register", json={"username": target, "email": f"{target}@x.com",
                                            "password": "pass123"})
    r = client.patch(f"/api/auth/users/{target}/role", json={"role": "admin"}, headers=admin)
    assert r.status_code == 200 and r.json()["role"] == "admin"
    r = client.patch(f"/api/auth/users/{target}/role", json={"role": "student"}, headers=admin)
    assert r.status_code == 200 and r.json()["role"] == "student"
    assert client.patch(f"/api/auth/users/{target}/role", json={"role": "god"},
                        headers=admin).status_code == 400
