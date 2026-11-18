"""Authenticated WebSocket fan-out with per-user audiences."""

import logging
from dataclasses import dataclass

log = logging.getLogger("campus_nexus.ws")


@dataclass(eq=False)
class Conn:
    ws: object
    username: str
    is_admin: bool


class ConnectionManager:
    def __init__(self):
        self.active: list[Conn] = []

    async def connect(self, ws, username: str, is_admin: bool) -> Conn:
        await ws.accept()
        conn = Conn(ws, username, is_admin)
        self.active.append(conn)
        return conn

    def disconnect(self, conn: Conn):
        if conn in self.active:
            self.active.remove(conn)

    def connected_usernames(self) -> set[str]:
        return {c.username for c in list(self.active)}

    async def deliver(self, event: str, data: dict, audience: set | None = None,
                      per_user: dict | None = None):
        """Send to every connection whose user is in ``audience`` (None = all).

        ``per_user`` maps username -> extra fields merged into that user's frame
        (e.g. the notify flag computed from their preferences).
        """
        dead = []
        for conn in list(self.active):
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
