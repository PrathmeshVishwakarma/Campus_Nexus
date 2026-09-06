from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.network import net_io_snapshot
from app.db.models.models import Peer
from app.db.session import get_db
from app.services import scheduler
from app.services.peer_discovery import broadcast_hello

router = APIRouter(prefix="/api", tags=["network"])


class Heartbeat(BaseModel):
    hostname: str
    ip: str
    latency_ms: float = 0.0


@router.get("/peers")
def peers(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return [{"hostname": p.hostname, "ip": p.ip, "status": p.status,
             "latency_ms": p.latency_ms, "last_seen": p.last_seen.isoformat()}
            for p in db.query(Peer).order_by(Peer.last_seen.desc()).all()]


@router.post("/peers/heartbeat")
def heartbeat(data: Heartbeat, db: Session = Depends(get_db)):
    p = db.query(Peer).filter(Peer.hostname == data.hostname).first()
    if not p:
        p = Peer(hostname=data.hostname, ip=data.ip)
        db.add(p)
    p.ip = data.ip
    p.latency_ms = data.latency_ms
    p.status = "online"
    p.last_seen = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/peers/discover")
def discover(db: Session = Depends(get_db), user=Depends(get_current_user)):
    broadcast_hello()
    return {"ok": True, "msg": "hello broadcasted"}


@router.get("/network/graph")
def graph(db: Session = Depends(get_db), user=Depends(get_current_user)):
    peers = db.query(Peer).all()
    # stale >60s without heartbeat => offline
    now = datetime.utcnow()
    for p in peers:
        if (now - p.last_seen).total_seconds() > 60:
            p.status = "offline"
    db.commit()
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
    from app.ml.anomaly import WINDOW
    return {"windows_tracked": len(WINDOW), "scheduler_paused": scheduler.is_paused(),
            "throttle": scheduler.throttle_status()}
