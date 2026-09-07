from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import Channel, Message, User
from app.db.session import get_db
from app.schemas import ChannelCreate, ChannelMembersUpdate, ChannelRename, EventCreate, MessageCreate
from app.services import event_service

router = APIRouter(prefix="/api/messages", tags=["messages"])


def _require_member(channel: Channel, username: str):
    if username not in (channel.members or []):
        raise HTTPException(403, "You are not a member of this channel")


@router.get("/channels")
def channels(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(Channel).all()
    return [{"id": c.id, "name": c.name, "type": c.type, "members": c.members} for c in rows]


@router.post("/channels")
async def create_channel(data: ChannelCreate, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    if db.query(Channel).filter(Channel.name == name).first():
        raise HTTPException(400, "A channel with this name already exists")
    members = data.members or [user.username]
    if user.username not in members:
        members.append(user.username)
    c = Channel(name=name, type=data.type, members=members)
    db.add(c)
    db.commit()
    db.refresh(c)
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "channel_created", "name": c.name}))
    return {"id": c.id, "name": c.name, "type": c.type, "members": c.members}


@router.patch("/channels/{channel_id}")
async def rename_channel(channel_id: int, data: ChannelRename, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    c = db.query(Channel).filter(Channel.id == channel_id).first()
    if not c:
        raise HTTPException(404, "Channel not found")
    _require_member(c, user.username)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    taken = db.query(Channel).filter(Channel.name == name, Channel.id != channel_id).first()
    if taken:
        raise HTTPException(400, "A channel with this name already exists")
    old = c.name
    c.name = name
    db.commit()
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "channel_renamed", "old": old, "name": name}))
    return {"id": c.id, "name": c.name, "type": c.type, "members": c.members}


@router.post("/channels/{channel_id}/members")
async def update_members(channel_id: int, data: ChannelMembersUpdate, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    c = db.query(Channel).filter(Channel.id == channel_id).first()
    if not c:
        raise HTTPException(404, "Channel not found")
    _require_member(c, user.username)
    members = list(c.members or [])
    for u in data.remove or []:
        if u == user.username:
            raise HTTPException(400, "You cannot remove yourself — delete the channel instead")
        if u in members:
            members.remove(u)
    for u in data.add or []:
        if not db.query(User).filter(User.username == u).first():
            raise HTTPException(400, f"User '{u}' does not exist")
        if u not in members:
            members.append(u)
    c.members = members
    db.commit()
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "members_updated",
                                                            "added": data.add or [],
                                                            "removed": data.remove or []}))
    return {"id": c.id, "name": c.name, "type": c.type, "members": c.members}


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: int, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    c = db.query(Channel).filter(Channel.id == channel_id).first()
    if not c:
        raise HTTPException(404, "Channel not found")
    _require_member(c, user.username)
    n_msgs = db.query(Message).filter(Message.channel_id == channel_id).count()
    db.query(Message).filter(Message.channel_id == channel_id).delete()
    db.delete(c)
    db.commit()
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{channel_id}", priority=60,
                                                   payload={"action": "channel_deleted", "name": c.name,
                                                            "messages_deleted": n_msgs}))
    return {"ok": True, "deleted_messages": n_msgs}


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
