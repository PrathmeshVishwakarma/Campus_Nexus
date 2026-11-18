from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.config import settings
from app.core.network import net_io_snapshot
from app.core.timeutil import utcnow
from app.db.models.models import Peer
from app.db.session import get_db
from app.services import scheduler
from app.services.peer_discovery import broadcast_hello

router = APIRouter(prefix="/api", tags=["network"])
STALE_AFTER_S = 60


class Heartbeat(BaseModel):
    hostname: str = Field(min_length=1, max_length=128)
    ip: str = Field(default="", max_length=64)
    latency_ms: float = Field(default=0.0, ge=0)


def mark_stale(db: Session) -> list[Peer]:
    peers = db.query(Peer).all()
    now = utcnow()
    changed = False
    for p in peers:
        if (now - p.last_seen).total_seconds() > STALE_AFTER_S and p.status != "offline":
            p.status = "offline"
            changed = True
    if changed:
        db.commit()
    return peers


@router.get("/peers")
def peers(db: Session = Depends(get_db), user=Depends(get_current_user)):
    mark_stale(db)
    return [{"hostname": p.hostname, "ip": p.ip, "status": p.status,
             "latency_ms": p.latency_ms, "last_seen": p.last_seen.isoformat()}
            for p in db.query(Peer).order_by(Peer.last_seen.desc()).all()]


@router.post("/peers/heartbeat")
def heartbeat(data: Heartbeat, request: Request, db: Session = Depends(get_db),
              user=Depends(get_current_user)):
    # Prefer the address we actually see; fall back to what the agent reports.
    seen_ip = request.client.host if request.client else ""
    ip = data.ip if (data.ip and seen_ip in ("127.0.0.1", "::1", "testclient", "")) else (seen_ip or data.ip)
    p = db.query(Peer).filter(Peer.hostname == data.hostname).first()
    if not p:
        p = Peer(hostname=data.hostname, ip=ip)
        db.add(p)
    p.ip = ip
    p.latency_ms = data.latency_ms
    p.status = "online"
    p.last_seen = utcnow()
    db.commit()
    return {"ok": True, "ip": ip}


@router.post("/peers/discover")
def discover(db: Session = Depends(get_db), user=Depends(get_current_user)):
    broadcast_hello(settings.discovery_port)
    return {"ok": True, "msg": "hello broadcasted"}


@router.get("/network/graph")
def graph(db: Session = Depends(get_db), user=Depends(get_current_user)):
    peers = mark_stale(db)
    now = utcnow()
    nodes = [{"id": p.hostname, "ip": p.ip, "latency": p.latency_ms, "status": p.status,
              "last_seen": p.last_seen.isoformat()} for p in peers]
    nodes.append({"id": "server", "ip": "127.0.0.1", "latency": 0.5, "status": "online",
                  "last_seen": now.isoformat()})
    edges = [{"from": "server", "to": p.hostname, "latency": p.latency_ms} for p in peers]
    isolated = [n["id"] for n in nodes if n["id"] != "server" and
                (n.get("latency", 0) > 500 or n.get("status") == "offline")]
    online = sum(1 for n in nodes if n["status"] == "online")
    return {"nodes": nodes, "edges": edges, "isolated": isolated,
            "central": "server", "online": online, "total": len(nodes)}


@router.get("/network/stats")
def stats(user=Depends(get_current_user)):
    return {"net_io": net_io_snapshot(), "scheduler_queue": scheduler.pending(),
            "throttle": scheduler.throttle_status()}


@router.get("/ml/anomalies")
def anomalies(user=Depends(get_current_user)):
    from app.ml.anomaly import status as ml_status
    return {**ml_status(), "scheduler_paused": scheduler.is_paused(),
            "throttle": scheduler.throttle_status()}
