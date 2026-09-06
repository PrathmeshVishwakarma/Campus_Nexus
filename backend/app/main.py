import asyncio
import socket
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import alerts, auth, events, files, messages, peers
from app.api.websockets.events_ws import broadcast_event, manager
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.schemas import EventCreate
from app.services import event_service, scheduler

Base.metadata.create_all(bind=engine)
event_service.set_broadcaster(broadcast_event)

app = FastAPI(title="Campus Nexus", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(events.router)
app.include_router(files.router)
app.include_router(messages.router)
app.include_router(alerts.router)
app.include_router(peers.router)


@app.get("/health")
def health():
    return {"ok": True, "node": socket.gethostname()}


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("action") == "PING":
                await ws.send_json({"event": "PONG", "data": {}})
            elif msg.get("action") == "ACK_ALERT":
                db = SessionLocal()
                try:
                    from app.db.models.models import AlertReceipt
                    r = db.query(AlertReceipt).filter(
                        AlertReceipt.alert_id == msg.get("alert_id")).first()
                    if r:
                        r.acked_at = datetime.utcnow()
                        db.commit()
                finally:
                    db.close()
    except WebSocketDisconnect:
        manager.disconnect(ws)


def _start_background():
    """File watcher -> Event bus + peer discovery -> DB, all in daemon threads."""
    from app.db.models.models import Peer
    from app.ml.anomaly import record_window
    from app.services.peer_discovery import start_listener_thread

    SHARED = Path(__file__).resolve().parents[3] / "shared" / "demo_files"
    SHARED.mkdir(parents=True, exist_ok=True)

    def on_fs(etype: str, path: str):
        db = SessionLocal()
        try:
            from app.services.sync_engine import sha256_file
            p = Path(path)
            sha = sha256_file(p)[:16] if p.exists() and p.is_file() else ""
            ev = event_service.emit_event_sync(db, EventCreate(
                type=etype, actor="node-agent", resource=path, priority=60,
                payload={"sha": sha}))
            record_window(1 if etype == "FILE_MODIFIED" else 0, 1 if etype == "FILE_DELETED" else 0,
                          1 if etype == "FILE_CREATED" else 0, 0.1)
            return ev
        except Exception as e:
            print("[watcher]", e)
        finally:
            db.close()

    try:
        from app.services.file_watcher import start_watcher as _sw
        _sw(SHARED, on_fs)
        print(f"[main] watching {SHARED}")
    except Exception as e:
        print("[main] watcher skipped (pip install watchdog to enable):", e)

    def on_peer(host: str, ip: str):
        db = SessionLocal()
        try:
            p = db.query(Peer).filter(Peer.hostname == host).first()
            if not p:
                from app.db.models.models import Peer as P
                db.add(P(hostname=host, ip=ip, status="online"))
            else:
                p.ip = ip
                p.status = "online"
                p.last_seen = datetime.utcnow()
            db.commit()
        finally:
            db.close()

    try:
        start_listener_thread(on_peer=on_peer)
    except Exception as e:
        print("[main] discovery skipped:", e)

    def stale_sweeper():
        import time
        while True:
            time.sleep(30)
            db = SessionLocal()
            try:
                now = datetime.utcnow()
                for p in db.query(Peer).all():
                    if (now - p.last_seen).total_seconds() > 60 and p.status != "offline":
                        p.status = "offline"
                db.commit()
            except Exception:
                pass
            finally:
                db.close()

    import threading as _th
    _th.Thread(target=stale_sweeper, daemon=True).start()


# sync emit helper (watcher runs outside async loop)
def _patch_sync_emit():
    import asyncio as _aio
    from app.db.models.models import Event as _Ev
    def emit_sync(db, data):
        ev = _Ev(**data.model_dump())
        db.add(ev)
        db.commit()
        db.refresh(ev)
        try:
            loop = _aio.get_event_loop()
            if loop.is_running():
                loop.create_task(broadcast_event(ev.type, {"id": ev.id, "type": ev.type}))
        except Exception:
            pass
        return ev
    event_service.emit_event_sync = emit_sync


_patch_sync_emit()


@app.on_event("startup")
async def startup():
    asyncio.create_task(scheduler.scheduler_loop())
    import threading
    threading.Thread(target=_start_background, daemon=True).start()
