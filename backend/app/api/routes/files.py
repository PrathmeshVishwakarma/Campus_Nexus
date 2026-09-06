import hashlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import FileVersion, SharedFolder
from app.db.session import get_db
from app.ml.anomaly import is_anomalous, record_window
from app.schemas import EventCreate, ShareFolderCreate
from app.services import event_service, scheduler
from app.services.sync_engine import bump_clock, chunk_file, detect_conflict, sha256_file

router = APIRouter(prefix="/api", tags=["files"])
SHARED = Path(__file__).resolve().parents[4] / "shared" / "demo_files"
NODE_ID = "server"


@router.post("/files/share")
async def share_folder(data: ShareFolderCreate, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    f = SharedFolder(name=data.name, path=data.path, owner_id=user.id)
    db.add(f)
    db.commit()
    await event_service.emit_event(db, EventCreate(type="FILE_SHARED", actor=user.username,
                                                   resource=data.path, priority=60,
                                                   payload={"folder": data.name}))
    return {"ok": True, "folder": data.name}


@router.get("/files")
def list_files(db: Session = Depends(get_db), user=Depends(get_current_user)):
    SHARED.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(SHARED.rglob("*")):
        if p.is_file():
            rel = str(p.relative_to(SHARED))
            latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
                FileVersion.version.desc()).first()
            out.append({"name": p.name, "path": rel, "size": p.stat().st_size,
                        "version": latest.version if latest else 1,
                        "hash": latest.hash_sha256[:12] if latest else "",
                        "modified_by": latest.modified_by if latest else ""})
    return out


@router.get("/files/versions")
def versions(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = db.query(FileVersion).filter(FileVersion.file_path == path).order_by(FileVersion.version).all()
    return [{"version": r.version, "hash": r.hash_sha256, "size": r.size,
             "by": r.modified_by, "at": r.timestamp.isoformat(),
             "chunks": r.chunks, "clock": r.vector_clock} for r in rows]


@router.get("/sync/manifest")
def manifest(path: str, user=Depends(get_current_user)):
    """Return existing chunk hashes so client uploads only missing/delta chunks (resume + dedup)."""
    target = SHARED / path
    if not target.exists():
        return {"exists": False, "chunks": [], "size": 0}
    return {"exists": True, "chunks": chunk_file(target), "size": target.stat().st_size,
            "sha256": sha256_file(target)}


@router.post("/sync/chunk")
async def upload_chunk(file: UploadFile, path: str, index: int = 0, total: int = 1,
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    SHARED.mkdir(parents=True, exist_ok=True)
    dest = SHARED / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = await file.read()
    # enqueue through priority scheduler for network-awareness (sync priority 40)
    mode = "wb" if index == 0 else "ab"
    with open(dest, mode) as f:
        f.write(data)
    await event_service.emit_event(db, EventCreate(type="SYNC_COMPLETED", actor=user.username,
                                                   resource=path, priority=40,
                                                   payload={"chunk": index, "of": total, "bytes": len(data)}))
    return {"ok": True, "chunk": index, "of": total, "sha": hashlib.sha256(data).hexdigest()}


@router.post("/sync/complete")
async def sync_complete(path: str, clock: dict | None = None, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    """Finalize upload: hash, version bump, conflict detect, anomaly check."""
    target = SHARED / path
    if not target.exists():
        raise HTTPException(404, "File not found after chunks")
    sha = sha256_file(target)
    size = target.stat().st_size
    chunks = chunk_file(target)
    clock = clock or {}
    clock = bump_clock(clock, user.username or NODE_ID)

    latest = db.query(FileVersion).filter(FileVersion.file_path == path).order_by(
        FileVersion.version.desc()).first()
    conflict = False
    if latest:
        if latest.hash_sha256 == sha:
            return {"ok": True, "deduped": True, "version": latest.version, "sha": sha}
        conflict = detect_conflict(latest.vector_clock or {}, clock)
        version = latest.version + 1
    else:
        version = 1

    fv = FileVersion(file_path=path, version=version, hash_sha256=sha, chunks=chunks,
                     size=size, modified_by=user.username, vector_clock=clock)
    db.add(fv)
    db.commit()

    # anomaly: single-file finalize counts as 1 modified window sample
    record_window(1, 0, 0, size / 1e6)
    anomalous, score = is_anomalous(1, 0, 0, size / 1e6)

    etype = "VERSION_CONFLICT" if conflict else "FILE_MODIFIED"
    await event_service.emit_event(db, EventCreate(
        type=etype, actor=user.username, resource=path, priority=90 if conflict else 60,
        payload={"version": version, "sha": sha[:16], "size": size,
                 "chunks": len(chunks), "conflict": conflict}, vector_clock=clock))
    if anomalous:
        scheduler.pause()
        await event_service.emit_event(db, EventCreate(
            type="ANOMALY_DETECTED", actor="ml-engine", resource=path, priority=100,
            payload={"reason": "anomalous sync burst", "score": score}))
    return {"ok": True, "version": version, "sha": sha, "conflict": conflict, "chunks": len(chunks)}


@router.get("/sync/download")
def download_chunk(path: str, index: int = 0, chunk_size: int = 1_048_576,
                   user=Depends(get_current_user)):
    from fastapi.responses import Response
    target = SHARED / path
    if not target.exists():
        raise HTTPException(404, "Not found")
    with open(target, "rb") as f:
        f.seek(index * chunk_size)
        data = f.read(chunk_size)
    return Response(content=data, media_type="application/octet-stream",
                    headers={"X-Chunk": str(index), "X-SHA": hashlib.sha256(data).hexdigest()})


@router.get("/sync/inspect")
def inspect(path: str, user=Depends(get_current_user)):
    target = SHARED / path
    if not target.exists():
        raise HTTPException(404, "Not found")
    return {"sha256": sha256_file(target), "chunks": chunk_file(target),
            "size": target.stat().st_size}


@router.post("/sync/report-activity")
async def report_activity(n_modified: int = 0, n_deleted: int = 0, n_created: int = 0,
                          total_mb: float = 0.0, db: Session = Depends(get_db),
                          user=Depends(get_current_user)):
    record_window(n_modified, n_deleted, n_created, total_mb)
    anomalous, score = is_anomalous(n_modified, n_deleted, n_created, total_mb)
    if anomalous:
        scheduler.pause()
        await event_service.emit_event(db, EventCreate(
            type="ANOMALY_DETECTED", actor=user.username, resource="filesystem",
            priority=100, payload={"modified": n_modified, "deleted": n_deleted,
                                   "created": n_created, "mb": total_mb, "score": score}))
        return {"anomaly": True, "action": "sync paused, versions preserved", "score": score}
    return {"anomaly": False, "score": score}


@router.get("/files/download")
def download_file(path: str, user=Depends(get_current_user)):
    target = SHARED / path
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(str(target), filename=target.name)


@router.post("/files/resolve")
async def resolve_conflict(path: str, strategy: str = "latest",
                           db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Resolve a VERSION_CONFLICT: strategy=latest|keep-mine. Records decision as event."""
    rows = db.query(FileVersion).filter(FileVersion.file_path == path).order_by(
        FileVersion.version.desc()).all()
    if not rows:
        raise HTTPException(404, "No versions for path")
    winner = rows[0] if strategy == "latest" else next(
        (r for r in rows if r.modified_by == user.username), rows[0])
    await event_service.emit_event(db, EventCreate(
        type="FILE_CONFLICT_RESOLVED", actor=user.username, resource=path, priority=70,
        payload={"strategy": strategy, "winner_version": winner.version,
                 "winner_by": winner.modified_by, "sha": winner.hash_sha256[:16]}))
    return {"ok": True, "winner_version": winner.version, "by": winner.modified_by}


@router.post("/sync/resume-scheduler")
async def resume_scheduler(db: Session = Depends(get_db), user=Depends(get_current_user)):
    scheduler.resume()
    await event_service.emit_event(db, EventCreate(type="SYNC_COMPLETED", actor=user.username,
                                                   resource="scheduler", priority=60,
                                                   payload={"action": "resumed"}))
    return {"ok": True}
