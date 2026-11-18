from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.api.websockets.events_ws import manager
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


class CongestionSimulationRequest(BaseModel):
    congested: bool
    rate: float | None = None
    capacity: float | None = None


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
def graph(user=Depends(get_current_user)):
    """Live topology: the server plus every user with an open web session.

    Presence comes from the WebSocket manager, so offline/stale rows in the
    legacy Peer table can never leak into the graph.
    """
    now = utcnow().isoformat()
    nodes = [{"id": "server", "label": "server", "role": "server", "ip": "127.0.0.1",
              "latency": 0.0, "status": "online", "last_seen": now, "connections": 1}]
    edges = []
    for u in manager.online_snapshot()["users"]:
        node_id = f"user:{u['username']}"
        nodes.append({"id": node_id, "label": u["username"], "role": u["role"],
                      "ip": "", "latency": 0.0, "status": "online", "last_seen": now,
                      "connections": u["connections"]})
        edges.append({"from": "server", "to": node_id, "latency": 0.0})
    return {"nodes": nodes, "edges": edges, "isolated": [],
            "central": "server", "online": len(nodes), "total": len(nodes)}


@router.get("/network/stats")
def stats(user=Depends(get_current_user)):
    return {"net_io": net_io_snapshot(), "scheduler_queue": scheduler.pending(),
            "throttle": scheduler.throttle_status()}


@router.post("/network/congestion")
def set_congestion(data: CongestionSimulationRequest, user=Depends(get_current_user)):
    """Simulate or reset network congestion for live demonstrations and testing."""
    scheduler.token_bucket.set_simulated_congestion(data.congested)
    if data.rate is not None and data.rate > 0:
        scheduler.token_bucket.rate = data.rate
    if data.capacity is not None and data.capacity > 0:
        scheduler.token_bucket.capacity = data.capacity
    return {
        "ok": True,
        "congested": scheduler.token_bucket.is_congested(),
        "throttle": scheduler.throttle_status(),
    }


@router.get("/ml/anomalies")
def anomalies(user=Depends(get_current_user)):
    from app.ml.anomaly import status as ml_status
    return {**ml_status(), "scheduler_paused": scheduler.is_paused(),
            "throttle": scheduler.throttle_status()}
