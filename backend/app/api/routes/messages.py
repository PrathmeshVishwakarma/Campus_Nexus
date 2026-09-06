from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import Channel, Message
from app.db.session import get_db
from app.schemas import ChannelCreate, EventCreate, MessageCreate
from app.services import event_service

router = APIRouter(prefix="/api/messages", tags=["messages"])


@router.get("/channels")
def channels(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(Channel).all()
    if not rows:
        # seed defaults on first use
        for name, typ in [("general", "group"), ("cs-department", "department")]:
            db.add(Channel(name=name, type=typ, members=[user.username]))
        db.commit()
        rows = db.query(Channel).all()
    return [{"id": c.id, "name": c.name, "type": c.type, "members": c.members} for c in rows]


@router.post("/channels")
async def create_channel(data: ChannelCreate, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    members = data.members or [user.username]
    if user.username not in members:
        members.append(user.username)
    c = Channel(name=data.name, type=data.type, members=members)
    db.add(c)
    db.commit()
    db.refresh(c)
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "channel_created", "name": c.name}))
    return {"id": c.id, "name": c.name, "type": c.type, "members": c.members}


@router.get("")
def list_messages(channel_id: int, file_link: str | None = None,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    q = db.query(Message).filter(Message.channel_id == channel_id)
    if file_link:
        q = q.filter(Message.file_link == file_link)
    return [{"id": m.id, "sender": m.sender, "content": m.content, "file_link": m.file_link,
             "read": m.read, "created_at": m.created_at.isoformat()}
            for m in q.order_by(Message.created_at).limit(500).all()]


@router.post("")
async def send(data: MessageCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    ch = db.query(Channel).filter(Channel.id == data.channel_id).first()
    if not ch:
        raise HTTPException(404, "Channel not found")
    m = Message(channel_id=data.channel_id, sender=user.username,
                content=data.content, file_link=data.file_link)
    db.add(m)
    db.commit()
    db.refresh(m)
    resource = f"channel:{data.channel_id}" + (f" file:{data.file_link}" if data.file_link else "")
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=resource, priority=80,
                                                   payload={"text": data.content[:200],
                                                            "file": data.file_link}))
    return {"id": m.id, "channel_id": m.channel_id, "sender": m.sender,
            "content": m.content, "file_link": m.file_link,
            "created_at": m.created_at.isoformat()}


@router.patch("/{msg_id}/read")
def mark_read(msg_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    m = db.query(Message).filter(Message.id == msg_id).first()
    if not m:
        raise HTTPException(404, "Not found")
    m.read = True
    db.commit()
    return {"ok": True}


@router.get("/unread/count")
def unread(channel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    n = db.query(Message).filter(Message.channel_id == channel_id,
                                 Message.read == False,  # noqa: E712
                                 Message.sender != user.username).count()
    return {"unread": n}
