from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.models.models import Event
from app.db.session import get_db
from app.schemas import EventCreate, EventOut
from app.services import event_service

router = APIRouter(prefix="/api/events", tags=["events"])


@router.post("", response_model=EventOut)
async def create_event(data: EventCreate, db: Session = Depends(get_db)):
    return await event_service.emit_event(db, data)


@router.get("", response_model=list[EventOut])
def list_events(type: str | None = None, resource: str | None = None,
                limit: int = Query(100, le=500), db: Session = Depends(get_db)):
    q = db.query(Event).order_by(Event.timestamp.desc())
    if type:
        q = q.filter(Event.type == type)
    if resource:
        q = q.filter(Event.resource.contains(resource))
    return q.limit(limit).all()
