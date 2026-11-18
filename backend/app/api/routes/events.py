from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import Event, User
from app.db.session import get_db
from app.schemas import EventCreate, EventIn, EventOut
from app.services import event_service
from app.services.visibility import AudienceResolver

router = APIRouter(prefix="/api/events", tags=["events"])


def visible_events(db: Session, user: User, q, limit: int) -> list[Event]:
    """Page through the query, keeping only events the user may see."""
    resolver = AudienceResolver(db)
    out: list[Event] = []
    offset, page = 0, max(limit * 2, 100)
    while len(out) < limit:
        rows = q.offset(offset).limit(page).all()
        if not rows:
            break
        out.extend(e for e in rows if resolver.can_view(user.username, e.type, e.resource, e.payload))
        offset += page
        if offset >= 5000:          # hard stop on very sparse visibility
            break
    return out[:limit]


@router.post("", response_model=EventOut)
async def create_event(data: EventIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return await event_service.emit_event(db, EventCreate(
        type=data.type.upper(), actor=user.username, resource=data.resource,
        priority=data.priority, payload=data.payload))


@router.get("", response_model=list[EventOut])
def list_events(type: str | None = None, resource: str | None = None,
                limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    q = db.query(Event).order_by(Event.timestamp.desc())
    if type:
        q = q.filter(Event.type == type)
    if resource:
        q = q.filter(Event.resource.contains(resource))
    return visible_events(db, user, q, limit)
