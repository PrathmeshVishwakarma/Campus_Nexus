import uuid

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.db.models.models import User
from app.db.session import SessionLocal
from app.main import app

client = TestClient(app)


def _register():
    u = f"u_{uuid.uuid4().hex[:6]}"
    assert client.post("/api/auth/register",
                       json={"username": u, "email": f"{u}@x.com",
                             "password": "pass123"}).status_code == 200
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


def test_locked_folder_hidden_from_non_members():
    admin_name, admin_h = _admin()
    outsider, out_h = _register()
    member, member_h = _register()
    folder = f"acl_{uuid.uuid4().hex[:6]}"

    try:
        # admin creates a folder restricted to itself
        r = client.post(f"/api/files/folders?subfolder={folder}",
                        json={"members": [admin_name]}, headers=admin_h)
        assert r.status_code == 200 and r.json()["locked"] is True

        # put a file inside it
        r = client.post(f"/api/sync/chunk?path={folder}/secret.txt&index=0&total=1",
                        files={"file": ("secret.txt", b"top secret")}, headers=admin_h)
        assert r.status_code == 200

        # outsiders cannot see the folder in either listing
        assert folder not in [f["name"] for f in client.get("/api/files/folders", headers=out_h).json()]
        tree = client.get("/api/files/tree", headers=out_h).json()
        assert folder not in [c["name"] for c in tree["children"]]

        # ...and cannot read, download or delete paths inside/at the folder
        assert client.get(f"/api/sync/manifest?path={folder}/secret.txt",
                          headers=out_h).status_code == 403
        assert client.get(f"/api/files/download?path={folder}/secret.txt",
                          headers=out_h).status_code == 403
        assert client.delete(f"/api/files/item?path={folder}",
                             headers=out_h).status_code == 403

        # grant the member access -> folder + file become visible
        r = client.post(f"/api/files/folders?subfolder={folder}",
                        json={"members": [admin_name, member]}, headers=admin_h)
        assert r.status_code == 200
        assert folder in [f["name"] for f in client.get("/api/files/folders", headers=member_h).json()]
        assert client.get(f"/api/sync/manifest?path={folder}/secret.txt",
                          headers=member_h).status_code == 200
    finally:
        client.delete(f"/api/files/item?path={folder}", headers=admin_h)
