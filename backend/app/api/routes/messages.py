from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_admin
from app.db.models.models import Channel, Message, MessageRead, NotificationPreference, User
from app.db.session import get_db
from app.schemas import ChannelCreate, ChannelMembersUpdate, ChannelRename, EventCreate, MessageCreate
from app.services import event_service
from app.api.websockets.events_ws import broadcast_event

router = APIRouter(prefix="/api/messages", tags=["messages"])
CHANNEL_TYPES = {"group", "dm", "department"}


def _channel(db: Session, channel_id: int, user: User) -> Channel:
    c = db.query(Channel).filter(Channel.id == channel_id).first()
    if not c or user.username not in (c.members or []):
        # same answer for "missing" and "not yours" — don't leak channel ids
        raise HTTPException(404, "Channel not found")
    return c


def _can_manage(c: Channel, user: User) -> bool:
    if is_admin(user) or c.type == "dm":
        return True                         # either DM participant may delete it
    return c.created_by == user.username if c.created_by else True


def _unread_counts(db: Session, username: str, channel_ids: list[int]) -> dict[int, int]:
    if not channel_ids:
        return {}
    read_ids = db.query(MessageRead.message_id).filter(MessageRead.username == username)
    rows = (db.query(Message.channel_id, func.count(Message.id))
            .filter(Message.channel_id.in_(channel_ids), Message.sender != username,
                    ~Message.id.in_(read_ids))
            .group_by(Message.channel_id).all())
    return {cid: n for cid, n in rows}


def _out(c: Channel, unread: int | None = None, muted: bool = False) -> dict:
    d = {"id": c.id, "name": c.name, "type": c.type, "members": c.members, "created_by": c.created_by,
         "muted": muted}
    if unread is not None:
        d["unread"] = unread
    return d


def muted_channel_ids(db: Session, user: User) -> set[int]:
    p = db.query(NotificationPreference).filter(NotificationPreference.user_id == user.id).first()
    return set(p.mute_channel_ids or []) if p else set()


@router.get("/channels")
def channels(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Channels the caller belongs to, with their unread counts."""
    rows = [c for c in db.query(Channel).filter(Channel.type != "file").order_by(Channel.id).all()
            if user.username in (c.members or [])]
    unread = _unread_counts(db, user.username, [c.id for c in rows])
    muted = muted_channel_ids(db, user)
    return [_out(c, unread.get(c.id, 0), c.id in muted) for c in rows]


@router.post("/channels")
async def create_channel(data: ChannelCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    name = (data.name or "").strip()
    ctype = (data.type or "group").lower()
    if ctype not in CHANNEL_TYPES:
        raise HTTPException(400, f"type must be one of {sorted(CHANNEL_TYPES)}")
    members = list(dict.fromkeys(data.members or []))
    if user.username not in members:
        members.append(user.username)
    for m in members:
        if not db.query(User.id).filter(User.username == m).first():
            raise HTTPException(400, f"User '{m}' does not exist")
    if ctype == "dm":
        if len(members) != 2:
            raise HTTPException(400, "A DM has exactly one other person")
        # one DM per pair: return the existing conversation
        for c in db.query(Channel).filter(Channel.type == "dm").all():
            if set(c.members or []) == set(members):
                return _out(c)
        name = name or " & ".join(sorted(members))
    else:
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        if db.query(Channel).filter(Channel.name == name, Channel.type != "dm").first():
            raise HTTPException(400, "A channel with this name already exists")
    c = Channel(name=name, type=ctype, members=members, created_by=user.username)
    db.add(c)
    db.commit()
    db.refresh(c)
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "channel_created", "name": c.name,
                                                            "channel_id": c.id}))
    return _out(c)


@router.patch("/channels/{channel_id}")
async def rename_channel(channel_id: int, data: ChannelRename, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    c = _channel(db, channel_id, user)
    name = (data.name or "").strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    if c.type != "dm" and db.query(Channel).filter(Channel.name == name, Channel.id != channel_id,
                                                   Channel.type != "dm").first():
        raise HTTPException(400, "A channel with this name already exists")
    old = c.name
    c.name = name
    db.commit()
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "channel_renamed", "old": old,
                                                            "name": name, "channel_id": c.id}))
    return _out(c)


@router.post("/channels/{channel_id}/members")
async def update_members(channel_id: int, data: ChannelMembersUpdate, db: Session = Depends(get_db),
                         user=Depends(get_current_user)):
    c = _channel(db, channel_id, user)
    if c.type == "dm":
        raise HTTPException(400, "DM members cannot change — start a group instead")
    removing_others = [u for u in (data.remove or []) if u != user.username]
    if removing_others and not _can_manage(c, user):
        raise HTTPException(403, "Only the channel creator or an admin can remove members")
    members = list(c.members or [])
    removed = []
    for u in data.remove or []:          # removing yourself = leaving the group
        if u in members:
            members.remove(u)
            removed.append(u)
    if not members:                      # last person left: nothing to keep
        mids = db.query(Message.id).filter(Message.channel_id == c.id)
        db.query(MessageRead).filter(MessageRead.message_id.in_(mids)).delete(synchronize_session=False)
        db.query(Message).filter(Message.channel_id == c.id).delete(synchronize_session=False)
        db.delete(c)
        db.commit()
        await broadcast_event("MESSAGE_SENT", {"actor": user.username, "resource": f"channel:{channel_id}",
                                               "payload": {"action": "channel_deleted", "channel_id": channel_id}},
                              set(removed))
        return {"id": channel_id, "deleted": True, "members": []}
    for u in data.add or []:
        if not db.query(User.id).filter(User.username == u).first():
            raise HTTPException(400, f"User '{u}' does not exist")
        if u not in members:
            members.append(u)
    c.members = members
    db.commit()
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=f"channel:{c.id}", priority=60,
                                                   payload={"action": "members_updated", "channel_id": c.id,
                                                            "added": data.add or [], "removed": removed}))
    if removed:  # tell removed users so their client drops the channel
        await broadcast_event("MESSAGE_SENT", {"actor": user.username, "resource": f"channel:{c.id}",
                                               "payload": {"action": "removed", "channel_id": c.id}},
                              set(removed))
    return _out(c)


@router.delete("/channels/{channel_id}")
async def delete_channel(channel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _channel(db, channel_id, user)
    if not _can_manage(c, user):
        raise HTTPException(403, "Only the channel creator or an admin can delete this channel")
    members = set(c.members or [])
    msg_ids = db.query(Message.id).filter(Message.channel_id == channel_id)
    n_msgs = msg_ids.count()
    db.query(MessageRead).filter(MessageRead.message_id.in_(msg_ids)).delete(synchronize_session=False)
    db.query(Message).filter(Message.channel_id == channel_id).delete(synchronize_session=False)
    name = c.name
    db.delete(c)
    db.commit()
    # the channel row is gone, so the audience can't be derived from it any more
    await broadcast_event("MESSAGE_SENT", {"actor": user.username, "resource": f"channel:{channel_id}",
                                           "payload": {"action": "channel_deleted", "name": name,
                                                       "channel_id": channel_id}}, members)
    await event_service.emit_event(db, EventCreate(type="CHANNEL_DELETED", actor=user.username,
                                                   resource="channels", priority=40,
                                                   payload={"messages_deleted": n_msgs}))
    return {"ok": True, "deleted_messages": n_msgs}


@router.get("")
def list_messages(channel_id: int, file_link: str | None = None,
                  db: Session = Depends(get_db), user=Depends(get_current_user)):
    c = _channel(db, channel_id, user)
    q = db.query(Message).filter(Message.channel_id == channel_id)
    if file_link:
        q = q.filter(Message.file_link == file_link)
    msgs = q.order_by(Message.created_at.desc(), Message.id.desc()).limit(500).all()[::-1]
    reads: dict[int, list[str]] = {}
    if msgs:
        for mid, uname in db.query(MessageRead.message_id, MessageRead.username).filter(
                MessageRead.message_id.in_([m.id for m in msgs])).all():
            reads.setdefault(mid, []).append(uname)
    others = len(set(c.members or []) - {user.username})
    out = []
    for m in msgs:
        read_by = [u for u in reads.get(m.id, []) if u != m.sender]
        if m.sender == user.username:
            read = bool(read_by)                         # someone else has read my message
        else:
            read = user.username in read_by              # I have read it
        out.append({"id": m.id, "sender": m.sender, "content": m.content, "file_link": m.file_link,
                    "read": read, "read_by": read_by,
                    "read_by_all": m.sender == user.username and others > 0 and len(read_by) >= others,
                    "created_at": m.created_at.isoformat()})
    return out


@router.post("")
async def send(data: MessageCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _channel(db, data.channel_id, user)
    content = data.content.strip()
    if not content:
        raise HTTPException(400, "Message cannot be empty")
    m = Message(channel_id=data.channel_id, sender=user.username, content=content, file_link=data.file_link)
    db.add(m)
    db.commit()
    db.refresh(m)
    resource = f"channel:{data.channel_id}" + (f" file:{data.file_link}" if data.file_link else "")
    await event_service.emit_event(db, EventCreate(type="MESSAGE_SENT", actor=user.username,
                                                   resource=resource, priority=80,
                                                   payload={"text": content[:200], "file": data.file_link,
                                                            "channel_id": data.channel_id, "message_id": m.id}))
    return {"id": m.id, "channel_id": m.channel_id, "sender": m.sender,
            "content": m.content, "file_link": m.file_link, "read": False, "read_by": [],
            "created_at": m.created_at.isoformat()}


def _mark(db: Session, username: str, message_ids: list[int]) -> int:
    if not message_ids:
        return 0
    already = {mid for (mid,) in db.query(MessageRead.message_id).filter(
        MessageRead.username == username, MessageRead.message_id.in_(message_ids)).all()}
    new = [mid for mid in message_ids if mid not in already]
    for mid in new:
        db.add(MessageRead(message_id=mid, username=username))
    try:
        db.commit()
    except IntegrityError:          # concurrent mark from another tab
        db.rollback()
    return len(new)


@router.patch("/{msg_id}/read")
async def mark_read(msg_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    m = db.query(Message).filter(Message.id == msg_id).first()
    if not m:
        raise HTTPException(404, "Not found")
    c = _channel(db, m.channel_id, user)
    if m.sender != user.username and _mark(db, user.username, [m.id]):
        await broadcast_event("MESSAGE_READ", {"actor": user.username, "resource": f"channel:{m.channel_id}",
                                               "payload": {"channel_id": m.channel_id, "ids": [m.id]}},
                              set(c.members or []))
    return {"ok": True}


@router.post("/read")
async def mark_channel_read(channel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Mark every message in a channel as read by the caller (one call, not one per message)."""
    c = _channel(db, channel_id, user)
    ids = [mid for (mid,) in db.query(Message.id).filter(Message.channel_id == channel_id,
                                                         Message.sender != user.username).all()]
    n = _mark(db, user.username, ids)
    if n:
        await broadcast_event("MESSAGE_READ", {"actor": user.username, "resource": f"channel:{channel_id}",
                                               "payload": {"channel_id": channel_id}}, set(c.members or []))
    return {"ok": True, "marked": n}


@router.post("/typing")
async def typing(channel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Transient TYPING frame — only the channel's members receive it."""
    c = _channel(db, channel_id, user)
    await broadcast_event("TYPING", {"actor": user.username, "resource": f"channel:{channel_id}",
                                     "payload": {"channel_id": channel_id}},
                          set(c.members or []) - {user.username})
    return {"ok": True}


@router.get("/unread/count")
def unread(channel_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _channel(db, channel_id, user)
    return {"unread": _unread_counts(db, user.username, [channel_id]).get(channel_id, 0)}
