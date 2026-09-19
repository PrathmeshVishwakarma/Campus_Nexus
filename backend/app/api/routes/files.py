"""Single-root shared files: one 'root' for all users, per-subfolder member ACL.

Layout on disk: <root>/<subfolder>/...  Root-level files are public to all
authenticated users. A top-level subfolder with a FolderACL row is visible
only to its members (plus admins). No ACL row = public (backwards compatible).
"""
import hashlib
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.api.websockets.events_ws import broadcast_event
from app.db.models.models import (
    Event,
    FileComment,
    FileThread,
    FileVersion,
    FolderACL,
    RootConfig,
    SharedFolder,
    User,
)
from app.db.session import get_db
from app.ml.anomaly import is_anomalous, record_window
from app.schemas import (
    EventCreate,
    FileCommentCreate,
    FolderACLUpdate,
    FolderMembersUpdate,
    RootUpdate,
    ShareFolderCreate,
)
from app.services import event_service, scheduler
from app.services.sync_engine import bump_clock, chunk_file, detect_conflict, sha256_file

router = APIRouter(prefix="/api", tags=["files"])
DEFAULT_ROOT = Path(__file__).resolve().parents[4] / "shared" / "demo_files"
NODE_ID = "server"


# ---- helpers ----
def _is_admin(user: User) -> bool:
    return (user.role or "").lower() == "admin"


def _require_admin(user: User):
    if not _is_admin(user):
        raise HTTPException(403, "Admin only")


def get_root(db: Session) -> Path:
    """Resolve the single shared root, creating default row/dir if needed."""
    row = db.query(RootConfig).filter(RootConfig.id == 1).first()
    if row and row.path:
        root = Path(row.path)
        if not root.is_absolute():
            root = Path(__file__).resolve().parents[4] / row.path
    else:
        root = DEFAULT_ROOT
    root.mkdir(parents=True, exist_ok=True)
    return root


def _top(rel: str) -> str:
    """Top-level subfolder of a relative path, '' for root-level files."""
    rel = (rel or "").strip().lstrip("/")
    return rel.split("/")[0] if "/" in rel else ""


def _safe_rel(path: str) -> str:
    rel = (path or "").strip().lstrip("/")
    if not rel or rel in (".", "/") or ".." in Path(rel).parts:
        raise HTTPException(400, "Invalid path")
    return rel


def _acl_map(db: Session) -> dict:
    return {r.subfolder: (r.members or []) for r in db.query(FolderACL).all()}


def can_access(db: Session, username: str, is_admin: bool, rel: str) -> bool:
    if is_admin:
        return True
    top = _top(rel)
    if not top:
        return True  # root-level files are shared with all
    row = db.query(FolderACL).filter(FolderACL.subfolder == top).first()
    if not row:
        return True  # no ACL row = public (backwards compatible)
    return username in (row.members or [])


def _require_access(db: Session, user: User, rel: str):
    if not can_access(db, user.username, _is_admin(user), rel):
        raise HTTPException(403, f"No access to '{_top(rel)}'")


# ---- root ----
@router.get("/files/root")
def get_root_path(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"path": str(get_root(db))}


@router.post("/files/root")
async def set_root_path(data: RootUpdate, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    """Move the single shared root to a new location (admin only).

    Same content, shifted: copy tree -> verify -> delete old contents.
    FileVersion paths are relative, so no DB rewrite is needed.
    """
    _require_admin(user)
    new_raw = (data.path or "").strip()
    if not new_raw:
        raise HTTPException(400, "Path required")
    new_root = Path(new_raw)
    if not new_root.is_absolute():
        new_root = (Path(__file__).resolve().parents[4] / new_raw).resolve()
    if new_root == Path("/"):
        raise HTTPException(400, "Invalid root path")
    old_root = get_root(db).resolve()
    if new_root == old_root:
        return {"ok": True, "path": str(old_root), "moved": False}
    new_root.mkdir(parents=True, exist_ok=True)
    # copy each entry, then verify file count matches before deleting old
    for entry in old_root.iterdir():
        dest = new_root / entry.name
        if dest.exists():
            raise HTTPException(409, f"Target already contains '{entry.name}' — merge manually")
        if entry.is_dir():
            shutil.copytree(entry, dest)
        else:
            shutil.copy2(entry, dest)
    old_files = sum(1 for _ in old_root.rglob("*") if _.is_file())
    new_files = sum(1 for _ in new_root.rglob("*") if _.is_file())
    if old_files != new_files:
        raise HTTPException(500, "Move verification failed — old folder kept")
    for entry in old_root.iterdir():
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    row = db.query(RootConfig).filter(RootConfig.id == 1).first()
    if not row:
        row = RootConfig(id=1, path=str(new_root), updated_by=user.username)
        db.add(row)
    else:
        row.path = str(new_root)
        row.updated_by = user.username
        row.updated_at = datetime.utcnow()
    db.commit()
    await event_service.emit_event(db, EventCreate(type="ROOT_MOVED", actor=user.username,
                                                   resource=str(new_root), priority=70,
                                                   payload={"from": str(old_root)}))
    return {"ok": True, "path": str(new_root), "moved": True, "files": new_files}


# ---- subfolders + ACL ----
@router.get("/files/folders")
def list_folders(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Top-level subfolders of root with member lists (filtered per user)."""
    root = get_root(db)
    admin = _is_admin(user)
    acls = _acl_map(db)
    seen = {p.name for p in root.iterdir() if p.is_dir()} | set(acls.keys())
    out = []
    for sub in sorted(seen):
        members = acls.get(sub)
        locked = members is not None
        if locked and not admin and user.username not in members:
            continue
        n_files = sum(1 for _ in (root / sub).rglob("*") if _.is_file()) if (root / sub).exists() else 0
        out.append({"name": sub, "path": sub, "members": members or [],
                    "locked": locked, "files": n_files})
    return out


@router.post("/files/folders")
async def upsert_folder_acl(data: FolderACLUpdate, subfolder: str,
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Create/update a subfolder + its member list (admin only)."""
    _require_admin(user)
    sub = (subfolder or "").strip().strip("/")
    if not sub or "/" in sub or sub in (".", ".."):
        raise HTTPException(400, "Subfolder must be a single top-level name")
    root = get_root(db)
    (root / sub).mkdir(parents=True, exist_ok=True)
    # validate members exist
    for m in data.members or []:
        if not db.query(User).filter(User.username == m).first():
            raise HTTPException(400, f"User '{m}' does not exist")
    row = db.query(FolderACL).filter(FolderACL.subfolder == sub).first()
    if not row:
        row = FolderACL(subfolder=sub, members=data.members or [], updated_by=user.username)
        db.add(row)
    else:
        row.members = data.members or []
        row.updated_by = user.username
        row.updated_at = datetime.utcnow()
    db.commit()
    await event_service.emit_event(db, EventCreate(type="FOLDER_ACL_UPDATED", actor=user.username,
                                                   resource=sub, priority=60,
                                                   payload={"members": data.members or []}))
    return {"ok": True, "subfolder": sub, "members": data.members or []}


@router.post("/files/folders/{subfolder}/members")
async def update_folder_members(subfolder: str, data: FolderMembersUpdate,
                                db: Session = Depends(get_db),
                                user=Depends(get_current_user)):
    _require_admin(user)
    row = db.query(FolderACL).filter(FolderACL.subfolder == subfolder).first()
    members = list(row.members or []) if row else []
    for u in data.remove or []:
        if u in members:
            members.remove(u)
    for u in data.add or []:
        if not db.query(User).filter(User.username == u).first():
            raise HTTPException(400, f"User '{u}' does not exist")
        if u not in members:
            members.append(u)
    if not row:
        row = FolderACL(subfolder=subfolder, members=members, updated_by=user.username)
        db.add(row)
    else:
        row.members = members
        row.updated_by = user.username
        row.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "subfolder": subfolder, "members": members}


@router.delete("/files/folders/{subfolder}")
async def delete_folder_acl(subfolder: str, db: Session = Depends(get_db),
                            user=Depends(get_current_user)):
    """Remove ACL (folder becomes public). Does not delete files."""
    _require_admin(user)
    row = db.query(FolderACL).filter(FolderACL.subfolder == subfolder).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True, "subfolder": subfolder, "locked": False}


# legacy: share-a-folder now creates a subfolder ACL entry
@router.post("/files/share")
async def share_folder(data: ShareFolderCreate, db: Session = Depends(get_db),
                       user=Depends(get_current_user)):
    _require_admin(user)
    sub = (data.path or data.name or "").strip().strip("/")
    top = sub.split("/")[0] if sub else ""
    if not top:
        raise HTTPException(400, "Folder path required")
    root = get_root(db)
    (root / top).mkdir(parents=True, exist_ok=True)
    if not db.query(FolderACL).filter(FolderACL.subfolder == top).first():
        db.add(FolderACL(subfolder=top, members=[], updated_by=user.username))
        db.commit()
    f = SharedFolder(name=data.name or top, path=top, owner_id=user.id)
    db.add(f)
    db.commit()
    db.refresh(f)
    await event_service.emit_event(db, EventCreate(type="FILE_SHARED", actor=user.username,
                                                   resource=top, priority=60,
                                                   payload={"folder": data.name or top}))
    return {"ok": True, "folder": top, "id": f.id}


@router.patch("/files/folders/{folder_id}/sync-toggle")
async def toggle_sync(folder_id: int, db: Session = Depends(get_db),
                      user=Depends(get_current_user)):
    """Legacy selective-sync toggle (kept for backwards compat)."""
    f = db.query(SharedFolder).filter(SharedFolder.id == folder_id).first()
    if not f:
        raise HTTPException(404, "Folder not found")
    f.sync_enabled = not f.sync_enabled
    db.commit()
    return {"id": f.id, "name": f.name, "sync_enabled": f.sync_enabled}


# ---- tree + files ----
@router.get("/files/tree")
def get_tree(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Nested root tree filtered by the caller's access."""
    root = get_root(db)
    admin = _is_admin(user)
    acls = _acl_map(db)

    def visible_sub(sub: str) -> bool:
        if sub not in acls:
            return True
        return admin or user.username in (acls[sub] or [])

    tree: dict = {"name": "root", "path": "", "type": "dir", "children": []}
    dirs: dict = {"": tree}
    # include known ACL subfolders even when empty on disk
    for sub in acls:
        if not visible_sub(sub) or sub in dirs:
            continue
        node = {"name": sub, "path": sub, "type": "dir",
                "locked": True, "members": acls[sub], "children": []}
        tree["children"].append(node)
        dirs[sub] = node
    for p in sorted(root.rglob("*")):
        rel = str(p.relative_to(root))
        if not can_access(db, user.username, admin, rel if p.is_file() else rel + "/x"):
            continue
        if p.is_dir():
            if rel in dirs:
                continue
            parent_rel = str(Path(rel).parent) if str(Path(rel).parent) != "." else ""
            parent = dirs.get(parent_rel, tree)
            node = {"name": p.name, "path": rel, "type": "dir", "children": []}
            parent["children"].append(node)
            dirs[rel] = node
        else:
            parent_rel = str(Path(rel).parent) if str(Path(rel).parent) != "." else ""
            parent = dirs.get(parent_rel)
            if parent is None:  # nested dir whose parent was created above
                continue
            latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
                FileVersion.version.desc()).first()
            parent.setdefault("children", []).append({
                "name": p.name, "path": rel, "type": "file", "size": p.stat().st_size,
                "version": latest.version if latest else 1,
                "hash": latest.hash_sha256[:12] if latest else "",
                "modified_by": latest.modified_by if latest else "",
            })
    return tree


@router.get("/files")
def list_files(subfolder: str | None = None, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
    root = get_root(db)
    admin = _is_admin(user)
    out = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = str(p.relative_to(root))
        if subfolder and not (rel == subfolder or rel.startswith(subfolder.rstrip("/") + "/")):
            continue
        if not can_access(db, user.username, admin, rel):
            continue
        latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
            FileVersion.version.desc()).first()
        out.append({"name": p.name, "path": rel, "size": p.stat().st_size,
                    "version": latest.version if latest else 1,
                    "hash": latest.hash_sha256[:12] if latest else "",
                    "modified_by": latest.modified_by if latest else ""})
    return out


@router.get("/files/versions")
def versions(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    rows = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(FileVersion.version).all()
    return [{"version": r.version, "hash": r.hash_sha256, "size": r.size,
             "by": r.modified_by, "at": r.timestamp.isoformat(),
             "chunks": r.chunks, "clock": r.vector_clock} for r in rows]


@router.get("/files/activity")
def file_activity(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Audit log for a file or subfolder (events filtered by resource)."""
    rel = _safe_rel(path) if path not in ("", "root", "/") else ""
    if rel:
        _require_access(db, user, rel)
    q = db.query(Event)
    if rel:
        q = q.filter((Event.resource == rel) | (Event.resource.startswith(rel + "/")) |
                      (Event.resource.startswith(rel + " file:")))
    rows = q.order_by(Event.timestamp.desc()).limit(200).all()
    return [{"id": e.id, "type": e.type, "actor": e.actor, "resource": e.resource,
             "priority": e.priority, "payload": e.payload,
             "timestamp": e.timestamp.isoformat()} for e in rows]


# ---- per-file discussions (detached from chat) ----
def _get_thread(db: Session, rel: str) -> FileThread | None:
    return db.query(FileThread).filter(FileThread.file_path == rel).first()


@router.get("/files/discussion")
def get_discussion(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    th = _get_thread(db, rel)
    if not th:
        return {"thread_id": None, "file_path": rel, "comments": []}
    rows = db.query(FileComment).filter(FileComment.thread_id == th.id).order_by(
        FileComment.created_at).limit(500).all()
    return {"thread_id": th.id, "file_path": rel,
            "comments": [{"id": c.id, "sender": c.sender, "content": c.content,
                          "created_at": c.created_at.isoformat()} for c in rows]}


@router.post("/files/discussion")
async def post_discussion(data: FileCommentCreate, db: Session = Depends(get_db),
                          user=Depends(get_current_user)):
    rel = _safe_rel(data.file_path)
    _require_access(db, user, rel)
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(400, "Content required")
    th = _get_thread(db, rel)
    if not th:
        th = FileThread(file_path=rel, created_by=user.username)
        db.add(th)
        db.commit()
        db.refresh(th)
    c = FileComment(thread_id=th.id, sender=user.username, content=content)
    db.add(c)
    db.commit()
    db.refresh(c)
    await event_service.emit_event(db, EventCreate(type="FILE_COMMENT", actor=user.username,
                                                   resource=rel, priority=60,
                                                   payload={"thread_id": th.id, "comment_id": c.id,
                                                            "text": content[:200]}))
    return {"ok": True, "thread_id": th.id, "comment": {
        "id": c.id, "sender": c.sender, "content": c.content,
        "created_at": c.created_at.isoformat()}}


# ---- sync (uploads land inside root) ----
@router.get("/sync/manifest")
def manifest(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    target = get_root(db) / rel
    if not target.exists():
        return {"exists": False, "chunks": [], "size": 0}
    return {"exists": True, "chunks": chunk_file(target), "size": target.stat().st_size,
            "sha256": sha256_file(target)}


@router.post("/sync/chunk")
async def upload_chunk(file: UploadFile, path: str, index: int = 0, total: int = 1,
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    root = get_root(db)
    dest = root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = await file.read()

    mode = "wb" if index == 0 else "ab"

    def _write():
        with open(dest, mode) as f:
            f.write(data)

    scheduler.enqueue(40, f"chunk:{rel}:{index}", _write)
    _write() if not scheduler.is_paused() else None

    await event_service.emit_event(db, EventCreate(type="SYNC_COMPLETED", actor=user.username,
                                                   resource=rel, priority=40,
                                                   payload={"chunk": index, "of": total, "bytes": len(data)}))
    return {"ok": True, "chunk": index, "of": total, "sha": hashlib.sha256(data).hexdigest()}


@router.post("/sync/complete")
async def sync_complete(path: str, clock: dict | None = None, db: Session = Depends(get_db),
                        user=Depends(get_current_user)):
    """Finalize upload: hash, version bump, conflict detect, anomaly check."""
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    target = get_root(db) / rel
    if not target.exists():
        raise HTTPException(404, "File not found after chunks")
    sha = sha256_file(target)
    size = target.stat().st_size
    chunks = chunk_file(target)
    clock = clock or {}
    clock = bump_clock(clock, user.username or NODE_ID)

    latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
        FileVersion.version.desc()).first()
    conflict = False
    if latest:
        if latest.hash_sha256 == sha:
            return {"ok": True, "deduped": True, "version": latest.version, "sha": sha}
        conflict = detect_conflict(latest.vector_clock or {}, clock)
        version = latest.version + 1
    else:
        version = 1

    fv = FileVersion(file_path=rel, version=version, hash_sha256=sha, chunks=chunks,
                     size=size, modified_by=user.username, vector_clock=clock)
    db.add(fv)
    db.commit()

    record_window(1, 0, 0, size / 1e6)
    anomalous, score = is_anomalous(1, 0, 0, size / 1e6)

    etype = "VERSION_CONFLICT" if conflict else "FILE_MODIFIED"
    await event_service.emit_event(db, EventCreate(
        type=etype, actor=user.username, resource=rel, priority=90 if conflict else 60,
        payload={"version": version, "sha": sha[:16], "size": size,
                 "chunks": len(chunks), "conflict": conflict}, vector_clock=clock))
    if anomalous:
        scheduler.pause()
        await event_service.emit_event(db, EventCreate(
            type="ANOMALY_DETECTED", actor="ml-engine", resource=rel, priority=100,
            payload={"reason": "anomalous sync burst", "score": score}))
    return {"ok": True, "version": version, "sha": sha, "conflict": conflict, "chunks": len(chunks)}


@router.get("/sync/download")
def download_chunk(path: str, index: int = 0, chunk_size: int = 1_048_576,
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    from fastapi.responses import Response
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    target = get_root(db) / rel
    if not target.exists():
        raise HTTPException(404, "Not found")
    with open(target, "rb") as f:
        f.seek(index * chunk_size)
        data = f.read(chunk_size)
    return Response(content=data, media_type="application/octet-stream",
                    headers={"X-Chunk": str(index), "X-SHA": hashlib.sha256(data).hexdigest()})


@router.get("/sync/inspect")
def inspect(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    target = get_root(db) / rel
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
def download_file(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    target = get_root(db) / rel
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(str(target), filename=target.name)


@router.post("/files/resolve")
async def resolve_conflict(path: str, strategy: str = "latest",
                           db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Resolve a VERSION_CONFLICT: strategy=latest|keep-mine. Records decision as event."""
    rel = _safe_rel(path)
    _require_access(db, user, rel)
    rows = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
        FileVersion.version.desc()).all()
    if not rows:
        raise HTTPException(404, "No versions for path")
    winner = rows[0] if strategy == "latest" else next(
        (r for r in rows if r.modified_by == user.username), rows[0])
    await event_service.emit_event(db, EventCreate(
        type="FILE_CONFLICT_RESOLVED", actor=user.username, resource=rel, priority=70,
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
