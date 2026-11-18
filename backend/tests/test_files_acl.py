import io
import uuid

from conftest import make_user


def _put(client, h, path, data=b"x"):
    uid = uuid.uuid4().hex
    r = client.post(f"/api/sync/chunk?path={path}&index=0&total=1&upload_id={uid}",
                    files={"file": ("f", io.BytesIO(data), "text/plain")}, headers=h)
    if r.status_code != 200:
        return r
    return client.post(f"/api/sync/complete?path={path}&upload_id={uid}", json={"size": len(data)}, headers=h)


def _names(tree):
    out = []

    def walk(n):
        out.append(n["path"])
        for c in n.get("children", []):
            walk(c)
    walk(tree)
    return out


def test_path_traversal_and_backslash_bypass_blocked(client, tmp_root):
    a, ha, _ = make_user(client)
    o, ho, _ = make_user(client)
    sub = f"priv_{uuid.uuid4().hex[:6]}"
    assert _put(client, ha, f"{sub}/secret.txt", b"top secret").status_code == 200
    assert client.post(f"/api/files/folders?subfolder={sub}", json={"members": [a]}, headers=ha).status_code == 200
    # backslash variant of the same path must hit the same ACL
    assert client.get(f"/api/files/download?path={sub}\\secret.txt", headers=ho).status_code == 403
    assert client.get(f"/api/files/download?path={sub}/secret.txt", headers=ho).status_code == 403
    for bad in ["../x", "..\\x", "C:/Windows/win.ini", "C:\\Windows\\win.ini", "/etc/passwd", "a/../../x"]:
        assert client.get(f"/api/files/download?path={bad}", headers=ha).status_code in (400, 404), bad
    # locked folder and its files are hidden from outsiders in tree + list
    names = _names(client.get("/api/files/tree", headers=ho).json())
    assert sub not in names and f"{sub}/secret.txt" not in names
    assert all(not f["path"].startswith(sub) for f in client.get("/api/files", headers=ho).json())
    assert sub in _names(client.get("/api/files/tree", headers=ha).json())


def test_cannot_lock_someone_elses_public_folder(client):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    sub = f"shared_{uuid.uuid4().hex[:6]}"
    assert _put(client, ha, f"{sub}/a.txt").status_code == 200
    assert _put(client, hb, f"{sub}/b.txt").status_code == 200
    r = client.post(f"/api/files/folders?subfolder={sub}", json={"members": [b]}, headers=hb)
    assert r.status_code == 403
    # a brand-new folder can be created and restricted by its creator (who stays a member)
    mine = f"mine_{uuid.uuid4().hex[:6]}"
    r = client.post(f"/api/files/folders?subfolder={mine}", json={"members": [a]}, headers=hb).json()
    assert r["locked"] and b in r["members"]


def test_delete_permissions(client, admin):
    a, ha, _ = make_user(client)
    b, hb, _ = make_user(client)
    _, ah, _ = admin
    sub = f"pub_{uuid.uuid4().hex[:6]}"
    _put(client, ha, f"{sub}/a.txt")
    _put(client, hb, f"{sub}/b.txt")
    assert client.delete(f"/api/files/item?path={sub}/a.txt", headers=hb).status_code == 403
    assert client.delete(f"/api/files/item?path={sub}", headers=hb).status_code == 403
    assert client.delete(f"/api/files/item?path={sub}/b.txt", headers=hb).status_code == 200
    assert client.delete(f"/api/files/item?path={sub}", headers=ah).status_code == 200


def test_activity_root_is_filtered(client):
    a, ha, _ = make_user(client)
    o, ho, _ = make_user(client)
    sub = f"hid_{uuid.uuid4().hex[:6]}"
    client.post(f"/api/files/folders?subfolder={sub}", json={"members": [a]}, headers=ha)
    _put(client, ha, f"{sub}/plan.txt")
    seen = [e["resource"] for e in client.get("/api/files/activity?path=", headers=ho).json()]
    assert not any(r.startswith(sub) for r in seen)
    seen = [e["resource"] for e in client.get("/api/files/activity?path=", headers=ha).json()]
    assert any(r.startswith(sub) for r in seen)


def test_root_move_admin_only(client, user):
    _, h, _ = user
    assert client.post("/api/files/root", json={"path": "elsewhere"}, headers=h).status_code == 403
    assert client.post("/api/files/reveal", headers=h).status_code == 403
