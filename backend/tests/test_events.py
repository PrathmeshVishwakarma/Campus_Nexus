from conftest import make_user


def test_health(client):
    assert client.get("/health").status_code == 200


def test_events_require_auth_and_actor_is_caller(client, user):
    u, h, _ = user
    assert client.post("/api/events", json={"type": "CUSTOM", "resource": "/x"}).status_code == 401
    assert client.get("/api/events").status_code == 401
    e = client.post("/api/events", json={"type": "custom", "resource": "/x", "priority": 50}, headers=h)
    assert e.status_code == 200
    assert e.json()["actor"] == u and e.json()["type"] == "CUSTOM"
    # priority is capped for client-submitted events
    assert client.post("/api/events", json={"type": "X", "priority": 100}, headers=h).status_code == 422


def test_register_ignores_role_and_validates(client):
    import uuid
    u = f"u_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/auth/register",
                    json={"username": u, "email": f"{u}@x.com", "password": "pass123", "role": "admin"})
    assert r.status_code == 200 and r.json()["role"] == "student"
    assert client.post("/api/auth/register",
                       json={"username": "x y", "email": "bad", "password": "1"}).status_code == 422


def test_admin_can_change_roles(client, admin, user):
    u, h, _ = user
    _, ah, _ = admin
    assert client.patch(f"/api/auth/users/{u}/role", json={"role": "faculty"}, headers=h).status_code == 403
    r = client.patch(f"/api/auth/users/{u}/role", json={"role": "faculty"}, headers=ah)
    assert r.status_code == 200 and r.json()["role"] == "faculty"
    assert client.patch(f"/api/auth/users/{u}/role", json={"role": "king"}, headers=ah).status_code == 400


def test_websocket_requires_token_and_filters_dm(client):
    a, ha, ta = make_user(client)
    b, hb, tb = make_user(client)
    c, hc, tc = make_user(client)
    import pytest
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/events") as ws:
            ws.receive_json()
    dm = client.post("/api/messages/channels", json={"name": "", "type": "dm", "members": [b]}, headers=ha).json()
    with client.websocket_connect(f"/ws/events?token={tb}") as wsb, \
            client.websocket_connect(f"/ws/events?token={tc}") as wsc:
        client.post("/api/messages", json={"channel_id": dm["id"], "content": "secret"}, headers=ha)
        frame = wsb.receive_json()
        assert frame["event"] == "MESSAGE_SENT" and frame["data"]["payload"]["text"] == "secret"
        assert frame["notify"] is True
        # outsider gets nothing about the DM; a public event arrives first instead
        client.post("/api/events", json={"type": "PUBLIC_PING"}, headers=ha)
        assert wsc.receive_json()["event"] == "PUBLIC_PING"
    # and the REST timeline hides it too
    texts = [e["payload"].get("text") for e in client.get("/api/events?limit=500", headers=hc).json()]
    assert "secret" not in texts
