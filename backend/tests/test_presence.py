import pytest

from app.api.websockets import events_ws


@pytest.fixture(autouse=True)
def isolate_presence():
    events_ws.manager.active.clear()
    yield
    events_ws.manager.active.clear()


def node_for(graph, label):
    return next((n for n in graph["nodes"] if n.get("label") == label), None)


def test_graph_shows_only_online_websocket_users(client, user):
    username, headers, token = user
    with client.websocket_connect(f"/ws/events?token={token}"):
        graph = client.get("/api/network/graph", headers=headers).json()

    assert node_for(graph, "server") is not None
    me = node_for(graph, username)
    assert me is not None
    assert me["status"] == "online"
    assert me["role"] == "student"
    assert all(n["status"] == "online" for n in graph["nodes"])
    assert graph["online"] == graph["total"] == len(graph["nodes"])
    assert graph["isolated"] == []


def test_legacy_peer_heartbeat_never_appears(client, user):
    _, headers, _ = user
    r = client.post("/api/peers/heartbeat",
                    json={"hostname": "ghost-node", "ip": "10.0.0.9"}, headers=headers)
    assert r.status_code == 200

    graph = client.get("/api/network/graph", headers=headers).json()
    assert not any(n["id"] == "ghost-node" or n.get("label") == "ghost-node"
                   for n in graph["nodes"])


def test_multiple_tabs_dedupe_and_disappear_after_last_close(client, user, monkeypatch):
    username, headers, token = user
    monkeypatch.setattr(events_ws, "GRACE_S", 0)

    with client.websocket_connect(f"/ws/events?token={token}"):
        with client.websocket_connect(f"/ws/events?token={token}"):
            me = node_for(client.get("/api/network/graph", headers=headers).json(), username)
            assert me is not None and me["connections"] == 2

        me = node_for(client.get("/api/network/graph", headers=headers).json(), username)
        assert me is not None and me["connections"] == 1

    graph = client.get("/api/network/graph", headers=headers).json()
    assert node_for(graph, username) is None


def test_presence_update_is_pushed_to_open_sockets(client, user, admin):
    username, _, token = user
    admin_name, _, admin_token = admin

    with client.websocket_connect(f"/ws/events?token={token}") as ws:
        first = ws.receive_json()
        assert first["event"] == "PRESENCE"
        assert {u["username"] for u in first["data"]["users"]} == {username}

        with client.websocket_connect(f"/ws/events?token={admin_token}"):
            second = ws.receive_json()
            assert second["event"] == "PRESENCE"
            assert {u["username"] for u in second["data"]["users"]} == {username, admin_name}
