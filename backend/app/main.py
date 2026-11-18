import asyncio
import logging
import socket
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import alerts, auth, events, files, messages, notifications, peers, push
from app.api.websockets.events_ws import manager
from app.core.config import settings
from app.core.timeutil import utcnow
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.services import event_service, scheduler
from app.services.storage import cleanup_stale_staging, get_root, on_root_changed

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("campus_nexus")

# Alembic owns the schema: bring the DB to head (stamping legacy create_all DBs).
init_db()
with SessionLocal() as _db:
    auth.promote_configured_admins(_db)


def _start_background():
    """File watcher -> versions + event bus; UDP discovery; stale-peer sweeper."""
    from app.db.models.models import Peer
    from app.services.file_watcher import watcher
    from app.services.peer_discovery import start_listener_thread

    with SessionLocal() as db:
        root = get_root(db)
        try:
            n = files.index_untracked(db, root)
            if n:
                log.info("indexed %d existing file(s) as v1", n)
        except Exception:
            log.exception("initial file indexing failed")

    def on_fs(etype: str, path: str):
        db = SessionLocal()
        try:
            _, guard = files.record_disk_change(db, get_root(db), path, etype)
            if guard and guard[0] and not scheduler.is_paused():
                scheduler.pause()
                from app.schemas import EventCreate
                event_service.emit_event_sync(db, EventCreate(
                    type="ANOMALY_DETECTED", actor="ml-engine", resource="filesystem", priority=100,
                    payload={"reason": "mass file activity burst on disk", "score": round(guard[1], 3),
                             "window": guard[2]}))
        except Exception:
            log.exception("watcher callback failed for %s", path)
        finally:
            db.close()

    try:
        watcher.start(root, on_fs)
        on_root_changed(watcher.restart)
        log.info("watching %s", root)
    except Exception as e:
        log.warning("file watcher disabled: %s", e)

    def on_peer(host: str, ip: str):
        db = SessionLocal()
        try:
            p = db.query(Peer).filter(Peer.hostname == host).first()
            if not p:
                db.add(Peer(hostname=host, ip=ip, status="online"))
            else:
                p.ip, p.status, p.last_seen = ip, "online", utcnow()
            db.commit()
        finally:
            db.close()

    try:
        start_listener_thread(port=settings.discovery_port, on_peer=on_peer)
    except Exception as e:
        log.warning("peer discovery disabled: %s", e)

    def sweeper():
        while True:
            time.sleep(30)
            try:
                with SessionLocal() as db:
                    peers.mark_stale(db)
                cleanup_stale_staging()
            except Exception:
                log.exception("sweeper failed")

    threading.Thread(target=sweeper, daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    event_service.set_loop(asyncio.get_running_loop())
    sched = asyncio.create_task(scheduler.scheduler_loop())
    threading.Thread(target=_start_background, daemon=True).start()
    try:
        yield
    finally:
        sched.cancel()
        event_service.set_loop(None)
        try:
            from app.services.file_watcher import watcher
            watcher.stop()
        except Exception:
            pass


app = FastAPI(title="Campus Nexus", version="0.3.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                   allow_methods=["*"], allow_headers=["*"])

app.include_router(auth.router)
app.include_router(events.router)
app.include_router(files.router)
app.include_router(messages.router)
app.include_router(alerts.router)
app.include_router(peers.router)
app.include_router(notifications.router)
app.include_router(push.router)


@app.get("/health")
def health():
    return {"ok": True, "node": socket.gethostname()}


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    """Live events. Requires ?token=<JWT>; each user only receives events they may see."""
    token = ws.query_params.get("token", "")
    with SessionLocal() as db:
        user = auth.user_from_token(token, db) if token else None
        username, admin = (user.username, auth.is_admin(user)) if user else ("", False)
        role = (user.role or "") if user else ""
    if not user:
        await ws.close(code=4401, reason="invalid or expired token")
        return
    conn = await manager.connect(ws, username, admin, role=role,
                                 ip=ws.client.host if ws.client else "")
    await manager.announce_presence()
    try:
        while True:
            try:
                msg = await ws.receive_json()
            except (WebSocketDisconnect, RuntimeError):
                break
            except Exception:
                continue   # malformed frame — ignore, keep connection alive
            try:
                if msg.get("action") == "PING":
                    await ws.send_json({"event": "PONG", "data": {}})
                elif msg.get("action") == "ACK_ALERT":
                    with SessionLocal() as db:
                        me = db.query(auth.User).filter(auth.User.username == username).first()
                        if me:
                            try:
                                await alerts.do_ack(db, str(msg.get("alert_id", "")), me)
                            except Exception as e:  # 404 etc. -> tell the client, keep socket
                                await ws.send_json({"event": "ERROR",
                                                    "data": {"action": "ACK_ALERT", "detail": str(e)}})
            except (WebSocketDisconnect, RuntimeError):
                break
            except Exception:
                continue
    finally:
        manager.disconnect(conn)
        try:
            await manager.announce_presence()
        except Exception:
            log.debug("presence broadcast failed", exc_info=True)
