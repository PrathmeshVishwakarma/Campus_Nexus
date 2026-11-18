"""Central event bus — every feature emits an Event.

Events are persisted, then pushed over the WebSocket only to the users allowed
to see them (see services/visibility.py), each frame carrying that user's
``notify`` flag (see services/notify.py).

``emit_event`` is for async request handlers; ``emit_event_sync`` is for
background threads (file watcher) and hands the push to the server's event
loop with ``run_coroutine_threadsafe``.
"""

import asyncio
import logging

from sqlalchemy.orm import Session

from app.api.websockets.events_ws import manager
from app.db.models.models import Event
from app.schemas import EventCreate
from app.services.notify import delivery_flags, load_prefs, should_notify
from app.services.visibility import AudienceResolver

log = logging.getLogger("campus_nexus.events")
_loop: asyncio.AbstractEventLoop | None = None


def set_loop(loop: asyncio.AbstractEventLoop | None):
    global _loop
    _loop = loop


def _frame_data(ev: Event) -> dict:
    return {"id": ev.id, "type": ev.type, "actor": ev.actor, "resource": ev.resource,
            "priority": ev.priority, "payload": ev.payload,
            "timestamp": ev.timestamp.isoformat()}


def _persist(db: Session, data: EventCreate) -> Event:
    ev = Event(**data.model_dump())
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev


def _plan_delivery(db: Session, ev: Event):
    """Compute (audience, per-user notify flags) for currently connected users."""
    audience = AudienceResolver(db).audience(ev.type, ev.resource, ev.payload)
    online = manager.connected_usernames()
    recipients = online if audience is None else (online & audience)
    prefs = load_prefs(db, recipients)
    per_user = {}
    for u in recipients:
        p = prefs.get(u)
        per_user[u] = {"notify": should_notify(p, ev.type, ev.actor, u, ev.resource, ev.payload or {}),
                       **delivery_flags(p)}
    return audience, per_user


async def emit_event(db: Session, data: EventCreate) -> Event:
    ev = _persist(db, data)
    try:
        audience, per_user = _plan_delivery(db, ev)
        await manager.deliver(ev.type, _frame_data(ev), audience, per_user)
    except Exception:
        log.exception("event push failed for %s", ev.id)
    return ev


def emit_event_sync(db: Session, data: EventCreate) -> Event:
    """Thread-safe variant for code running outside the event loop."""
    ev = _persist(db, data)
    loop = _loop
    if loop is None or loop.is_closed():
        return ev
    try:
        audience, per_user = _plan_delivery(db, ev)
        asyncio.run_coroutine_threadsafe(
            manager.deliver(ev.type, _frame_data(ev), audience, per_user), loop)
    except Exception:
        log.exception("event push failed for %s", ev.id)
    return ev
