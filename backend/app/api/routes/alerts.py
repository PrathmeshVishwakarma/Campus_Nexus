from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import Alert, AlertReceipt, User
from app.db.session import get_db
from app.schemas import AlertCreate, EventCreate, PRIORITY_MAP
from app.services import event_service, scheduler

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.post("")
async def create_alert(data: AlertCreate, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    prio = data.priority.upper()
    a = Alert(title=data.title, body=data.body, priority=prio,
              sender=user.username, target_scope=data.target_scope)
    db.add(a)
    db.commit()
    db.refresh(a)
    # delivery receipts for every user (offline queue = no ack yet)
    for u in db.query(User).all():
        db.add(AlertReceipt(alert_id=a.id, user=u.username, latency_ms=0.0))
    db.commit()
    # high-priority alerts jump the scheduler queue
    scheduler.enqueue(PRIORITY_MAP.get(prio, 40), f"alert:{a.id}",
                      lambda: print(f"[scheduler] dispatched {a.id}"))
    await event_service.emit_event(db, EventCreate(
        type="ALERT_CREATED", actor=user.username, resource=a.id,
        priority=PRIORITY_MAP.get(prio, 40),
        payload={"title": a.title, "priority": prio, "scope": data.target_scope}))
    return {"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
            "sender": a.sender, "created_at": a.created_at.isoformat()}


@router.get("")
def list_alerts(priority: str | None = None, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    q = db.query(Alert).order_by(Alert.created_at.desc())
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
    alerts = db.query(Alert).order_by(Alert.created_at.desc()).limit(100).all()
    return rank_alerts(db, user.username, alerts)


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
