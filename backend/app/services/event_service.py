"""Central event bus — every feature emits an Event."""

from sqlalchemy.orm import Session

from app.db.models.models import Event
from app.schemas import EventCreate

# Will be set by main.py to the live WebSocket manager
_broadcast = None


def set_broadcaster(fn):
    global _broadcast
    _broadcast = fn


async def emit_event(db: Session, data: EventCreate) -> Event:
    ev = Event(**data.model_dump())
    db.add(ev)
    db.commit()
    db.refresh(ev)
    if _broadcast is not None:
        try:
            await _broadcast(ev.type, {"id": ev.id, "type": ev.type, "actor": ev.actor,
                                       "resource": ev.resource, "priority": ev.priority,
                                       "payload": ev.payload,
                                       "timestamp": ev.timestamp.isoformat()})
        except Exception:
            pass
    return ev
