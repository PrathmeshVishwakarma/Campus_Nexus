from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_admin
from app.core.security import ROLES
from app.core.timeutil import utcnow
from app.db.models.models import Alert, AlertReceipt, User
from app.db.session import get_db
from app.schemas import PRIORITY_MAP, AlertCreate, EventCreate
from app.services import event_service, scheduler

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Who may broadcast high-priority alerts.
HIGH_PRIORITY = {"CRITICAL", "URGENT"}
HIGH_PRIORITY_ROLES = {"admin", "faculty", "staff"}


def resolve_targets(db: Session, scope: str, sender: str) -> tuple[str, list[str]]:
    """Parse target_scope into (normalized scope, recipient usernames).

    all                 every user
    role:<r1>[,<r2>]    users with one of those roles
    users:<u1>,<u2>     named users
    """
    scope = (scope or "all").strip()
    if scope.lower() == "all":
        users = [u for (u,) in db.query(User.username).all()]
        return "all", [u for u in users if u != sender]
    kind, _, rest = scope.partition(":")
    names = [x.strip() for x in rest.split(",") if x.strip()]
    if kind.lower() == "role" and names:
        roles = [r.lower() for r in names]
        bad = [r for r in roles if r not in ROLES]
        if bad:
            raise HTTPException(400, f"Unknown role(s): {bad}")
        users = [u for (u,) in db.query(User.username).filter(User.role.in_(roles)).all()]
        return f"role:{','.join(roles)}", [u for u in users if u != sender]
    if kind.lower() == "users" and names:
        found = {u for (u,) in db.query(User.username).filter(User.username.in_(names)).all()}
        missing = [n for n in names if n not in found]
        if missing:
            raise HTTPException(400, f"Unknown user(s): {missing}")
        return f"users:{','.join(names)}"[:64], [u for u in names if u != sender]
    raise HTTPException(400, "target_scope must be 'all', 'role:<role>[,...]' or 'users:<u1>,<u2>'")


def _visible(db: Session, alert: Alert, user: User) -> bool:
    if (alert.target_scope or "all") == "all" or alert.sender == user.username or is_admin(user):
        return True
    return db.query(AlertReceipt.id).filter(AlertReceipt.alert_id == alert.id,
                                            AlertReceipt.user == user.username).first() is not None


def visible_alerts(db: Session, user: User, priority: str | None = None, limit: int = 100) -> list[Alert]:
    q = db.query(Alert).order_by(Alert.created_at.desc())
    if priority:
        q = q.filter(Alert.priority == priority.upper())
    if not is_admin(user):
        mine = db.query(AlertReceipt.alert_id).filter(AlertReceipt.user == user.username)
        q = q.filter((Alert.target_scope == "all") | (Alert.sender == user.username) | Alert.id.in_(mine))
    return q.limit(limit).all()


async def do_ack(db: Session, alert_id: str, user: User) -> AlertReceipt:
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a or not _visible(db, a, user):
        raise HTTPException(404, "Alert not found")
    r = db.query(AlertReceipt).filter(AlertReceipt.alert_id == alert_id,
                                      AlertReceipt.user == user.username).first()
    if not r:
        r = AlertReceipt(alert_id=alert_id, user=user.username)
        db.add(r)
    if r.acked_at is None:
        r.acked_at = utcnow()
        r.latency_ms = (r.acked_at - a.created_at).total_seconds() * 1000
        db.commit()
        await event_service.emit_event(db, EventCreate(type="ALERT_ACKNOWLEDGED", actor=user.username,
                                                       resource=alert_id, priority=80,
                                                       payload={"latency_ms": round(r.latency_ms, 1)}))
    return r


@router.post("")
async def create_alert(data: AlertCreate, db: Session = Depends(get_db), user=Depends(get_current_user)):
    prio = data.priority
    if prio in HIGH_PRIORITY and (user.role or "").lower() not in HIGH_PRIORITY_ROLES:
        raise HTTPException(403, f"Only {sorted(HIGH_PRIORITY_ROLES)} may send {prio} alerts")
    scope, recipients = resolve_targets(db, data.target_scope, user.username)
    a = Alert(title=data.title, body=data.body, priority=prio, sender=user.username, target_scope=scope)
    db.add(a)
    db.commit()
    db.refresh(a)
    # delivery receipts for every recipient (offline queue = no ack yet)
    for u in recipients:
        db.add(AlertReceipt(alert_id=a.id, user=u, delivered_at=a.created_at))
    db.commit()
    # high-priority alerts jump the scheduler queue
    scheduler.enqueue(PRIORITY_MAP.get(prio, 40), f"alert:{a.id}",
                      lambda aid=a.id: print(f"[scheduler] dispatched {aid}"))
    await event_service.emit_event(db, EventCreate(
        type="ALERT_CREATED", actor=user.username, resource=a.id, priority=PRIORITY_MAP.get(prio, 40),
        payload={"title": a.title, "priority": prio, "scope": scope, "recipients": len(recipients)}))
    return {"id": a.id, "title": a.title, "body": a.body, "priority": a.priority, "sender": a.sender,
            "target_scope": scope, "created_at": a.created_at.isoformat()}


@router.get("")
def list_alerts(priority: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    alerts = visible_alerts(db, user, priority)
    ids = [a.id for a in alerts]
    receipts: dict[str, list[AlertReceipt]] = {}
    if ids:
        for r in db.query(AlertReceipt).filter(AlertReceipt.alert_id.in_(ids)).all():
            receipts.setdefault(r.alert_id, []).append(r)
    out = []
    for a in alerts:
        rs = receipts.get(a.id, [])
        mine = next((r for r in rs if r.user == user.username), None)
        out.append({"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
                    "sender": a.sender, "target_scope": a.target_scope,
                    "created_at": a.created_at.isoformat(),
                    "acked": sum(1 for r in rs if r.acked_at), "total": len(rs),
                    "acked_by_me": bool(mine and mine.acked_at)})
    return out


@router.get("/ranked")
def ranked(db: Session = Depends(get_db), user=Depends(get_current_user)):
    from app.ml.ranker import rank_alerts
    return rank_alerts(db, user.username, visible_alerts(db, user))


@router.post("/{alert_id}/ack")
async def ack(alert_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    r = await do_ack(db, alert_id, user)
    return {"ok": True, "latency_ms": round(r.latency_ms, 1)}


@router.get("/{alert_id}/receipts")
def receipts(alert_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    a = db.query(Alert).filter(Alert.id == alert_id).first()
    if not a or not _visible(db, a, user):
        raise HTTPException(404, "Alert not found")
    rows = db.query(AlertReceipt).filter(AlertReceipt.alert_id == alert_id).all()
    return [{"user": r.user, "delivered_at": r.delivered_at.isoformat(),
             "acked_at": r.acked_at.isoformat() if r.acked_at else None,
             "latency_ms": round(r.latency_ms, 1) if r.acked_at else None} for r in rows]
