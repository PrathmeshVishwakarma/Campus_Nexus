from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import Alert, AlertReceipt, User
from app.db.session import get_db
from app.schemas import AlertCreate, EventCreate, PRIORITY_MAP
from app.services import event_service, push_service, scheduler

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.post("")
async def create_alert(data: AlertCreate, background: BackgroundTasks,
                       db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    prio = data.priority.upper()
    wanted = list(dict.fromkeys(data.target_users or []))
    if wanted:
        found = {u.username for u in db.query(User).filter(User.username.in_(wanted)).all()}
        missing = [u for u in wanted if u not in found]
        if missing:
            raise HTTPException(400, f"Unknown user(s): {', '.join(missing)}")
        recipients = wanted
        scope = "selected"
    else:
        recipients = [u.username for u in db.query(User).all()]
        scope = "all"

    a = Alert(title=data.title, body=data.body, priority=prio,
              sender=user.username, target_scope=scope)
    db.add(a)
    db.commit()
    db.refresh(a)

    # Delivery receipts only for the targets. The sender is auto-acknowledged
    # (they obviously know about their own alert) and always sees it.
    now = datetime.utcnow()
    targets = set(recipients)
    for name in recipients:
        db.add(AlertReceipt(alert_id=a.id, user=name, latency_ms=0.0,
                            acked_at=now if name == user.username else None))
    if user.username not in targets:
        db.add(AlertReceipt(alert_id=a.id, user=user.username, latency_ms=0.0, acked_at=now))
    db.commit()

    # high-priority alerts jump the scheduler queue
    scheduler.enqueue(PRIORITY_MAP.get(prio, 40), f"alert:{a.id}",
                      lambda: print(f"[scheduler] dispatched {a.id}"))
    await event_service.emit_event(db, EventCreate(
        type="ALERT_CREATED", actor=user.username, resource=a.id,
        priority=PRIORITY_MAP.get(prio, 40),
        payload={"title": a.title, "priority": prio, "scope": scope,
                 "targets": sorted(targets) if scope == "selected" else []}))

    # Real push so recipients get a system notification even with the site closed.
    push_targets = [name for name in recipients if name != user.username]
    background.add_task(push_service.send_alert_push, push_targets, {
        "id": a.id, "title": a.title, "body": a.body,
        "priority": prio, "url": "/alerts",
    })
    return {"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
            "sender": a.sender, "created_at": a.created_at.isoformat()}


@router.get("")
def list_alerts(priority: str | None = None, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    q = (db.query(Alert)
         .join(AlertReceipt, AlertReceipt.alert_id == Alert.id)
         .filter(AlertReceipt.user == user.username)
         .order_by(Alert.created_at.desc()))
    if priority:
        q = q.filter(Alert.priority == priority.upper())
    alerts = q.limit(100).all()
    out = []
    for a in alerts:
        receipts = db.query(AlertReceipt).filter(AlertReceipt.alert_id == a.id).all()
        acked = sum(1 for r in receipts if r.acked_at)
        mine = next((r for r in receipts if r.user == user.username), None)
        out.append({"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
                    "sender": a.sender, "created_at": a.created_at.isoformat(),
                    "acked": acked, "total": len(receipts),
                    "acked_by_me": bool(mine and mine.acked_at)})
    return out


@router.get("/ranked")
def ranked(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from app.ml.ranker import rank_alerts
    alerts = (db.query(Alert)
              .join(AlertReceipt, AlertReceipt.alert_id == Alert.id)
              .filter(AlertReceipt.user == user.username)
              .order_by(Alert.created_at.desc()).limit(100).all())
    out = rank_alerts(db, user.username, alerts)
    for item in out:
        rows = db.query(AlertReceipt).filter(AlertReceipt.alert_id == item["id"]).all()
        mine = next((r for r in rows if r.user == user.username), None)
        item["acked"] = sum(1 for r in rows if r.acked_at)
        item["total"] = len(rows)
        item["acked_by_me"] = bool(mine and mine.acked_at)
    return out


_PRIORITY_RANK = {"CRITICAL": 5, "URGENT": 4, "IMPORTANT": 3, "NORMAL": 2, "INFO": 1}


@router.get("/unacked/count")
def unacked_count(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Number of alerts this user received but has not acknowledged + top priority."""
    rows = (db.query(Alert)
            .join(AlertReceipt, AlertReceipt.alert_id == Alert.id)
            .filter(AlertReceipt.user == user.username,
                    AlertReceipt.acked_at.is_(None)).all())
    top = None
    for a in rows:
        if top is None or _PRIORITY_RANK.get(a.priority.upper(), 0) > _PRIORITY_RANK.get(top, 0):
            top = a.priority.upper()
    return {"count": len(rows), "priority": top}


@router.post("/{alert_id}/ack")
async def ack(alert_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a:
        raise HTTPException(404, "Alert not found")
    r = db.query(AlertReceipt).filter(AlertReceipt.alert_id == alert_id,
                                      AlertReceipt.user == user.username).first()
    if not r:
        r = AlertReceipt(alert_id=alert_id, user=user.username,
                         latency_ms=(datetime.utcnow() - a.created_at).total_seconds() * 1000)
        db.add(r)
    r.acked_at = datetime.utcnow()
    r.latency_ms = (r.acked_at - a.created_at).total_seconds() * 1000
    db.commit()
    await event_service.emit_event(db, EventCreate(type="ALERT_ACKNOWLEDGED",
                                                   actor=user.username, resource=alert_id, priority=80,
                                                   payload={"latency_ms": round(r.latency_ms, 1)}))
    return {"ok": True, "latency_ms": round(r.latency_ms, 1)}


@router.get("/{alert_id}/receipts")
def receipts(alert_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(AlertReceipt).filter(AlertReceipt.alert_id == alert_id).all()
    return [{"user": r.user, "delivered_at": r.delivered_at.isoformat(),
             "acked_at": r.acked_at.isoformat() if r.acked_at else None,
             "latency_ms": round(r.latency_ms, 1)} for r in rows]
