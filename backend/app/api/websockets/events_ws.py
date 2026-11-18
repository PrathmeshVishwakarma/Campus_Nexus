"""Authenticated WebSocket fan-out with per-user audiences."""

import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger("campus_nexus.ws")

# Keep a user visible for a moment after their last socket drops so tab
# refreshes and brief Wi-Fi hiccups don't flicker the network graph.
GRACE_S = 15.0


@dataclass(eq=False)
class Conn:
    ws: object
    username: str
    is_admin: bool
    role: str = ""
    ip: str = ""
    connected_at: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)
    disconnected_at: float | None = None


class ConnectionManager:
    def __init__(self):
        self.active: list[Conn] = []

    async def connect(self, ws, username: str, is_admin: bool,
                      role: str = "", ip: str = "") -> Conn:
        await ws.accept()
        conn = Conn(ws, username, is_admin, role=role, ip=ip)
        self.active.append(conn)
        return conn

    def disconnect(self, conn: Conn):
        if conn in self.active and conn.disconnected_at is None:
            conn.disconnected_at = time.monotonic()

    def purge(self):
        """Drop connections whose grace period has elapsed."""
        now = time.monotonic()
        self.active = [c for c in self.active
                       if c.disconnected_at is None or now - c.disconnected_at < GRACE_S]

    def connected_usernames(self) -> set[str]:
        return {c.username for c in list(self.active) if c.disconnected_at is None}

    def online_snapshot(self) -> dict:
        """Distinct users with a live socket (or still inside their grace window)."""
        self.purge()
        users: dict[str, dict] = {}
        for c in self.active:
            rec = users.setdefault(c.username,
                                   {"username": c.username, "role": c.role, "connections": 0})
            if c.disconnected_at is None:
                rec["connections"] += 1
        return {"users": sorted(users.values(), key=lambda u: u["username"]),
                "online": len(users)}

    async def announce_presence(self):
        await self.deliver("PRESENCE", self.online_snapshot())

    async def deliver(self, event: str, data: dict, audience: set | None = None,
                      per_user: dict | None = None):
        """Send to every connection whose user is in ``audience`` (None = all).

        ``per_user`` maps username -> extra fields merged into that user's frame
        (e.g. the notify flag computed from their preferences).
        """
        self.purge()
        dead = []
        for conn in list(self.active):
            if conn.disconnected_at is not None:
                continue
            if audience is not None and conn.username not in audience:
                continue
            frame = {"event": event, "data": data}
            if per_user and conn.username in per_user:
                frame.update(per_user[conn.username])
            try:
                await conn.ws.send_json(frame)
            except Exception:
                dead.append(conn)
        for conn in dead:
            self.disconnect(conn)


manager = ConnectionManager()


async def broadcast_event(event: str, data: dict, audience: set | None = None):
    """Backwards-compatible helper for transient frames (no notify computation)."""
    await manager.deliver(event, data, audience)
