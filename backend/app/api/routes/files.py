"""Single-root shared files: one 'root' for all users, per-subfolder member ACL.

Access rules
------------
* Root-level files and subfolders without an ACL row are public.
* A subfolder with an ACL row is visible only to its members and admins.
* Setting the first ACL on a folder: admins, or a user who created every file
  in it (or the folder is new/empty). Changing an existing ACL: admins.
* Deleting a file: admins, the file's creator, or members of its locked folder.
  Deleting a whole folder: admins, or a user who created every file in it.
"""

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user, is_admin, require_admin
from app.api.routes.events import visible_events
from app.core.config import settings
from app.core.timeutil import utcnow
from app.db.models.models import Event, FileComment, FileThread, FileVersion, FolderACL, RootConfig, User
from app.db.session import get_db
from app.ml import anomaly
from app.schemas import (
    EventCreate,
    FileCommentCreate,
    FolderACLUpdate,
    FolderDiffRequest,
    FolderMembersUpdate,
    RootUpdate,
    SyncComplete,
)
from app.services import event_service, scheduler
from app.services.storage import (
    blob_path,
    gc_blobs,
    get_root,
    normalize_rel,
    notify_root_changed,
    place_file,
    rel_of,
    resolve_in_root,
    sha256_file,
    staging_path,
    store_blob,
    suppress_watcher,
    write_chunk,
)
from app.services.sync_engine import bump_clock, chunk_file, detect_conflict, merge_clocks
from app.services.visibility import top_folder

router = APIRouter(prefix="/api", tags=["files"])
MAX_DOWNLOAD_CHUNK = 8 * 1_048_576


# ---------------------------------------------------------------- access helpers
def _acl_map(db: Session) -> dict[str, list]:
    return {r.subfolder: (r.members or []) for r in db.query(FolderACL).all()}


def can_access(acl: dict, username: str, admin: bool, rel: str) -> bool:
    if admin:
        return True
    top = top_folder(rel)
    if not top or top not in acl:
        return True
    return username in (acl[top] or [])


def _require_access(db: Session, user: User, rel: str, acl: dict | None = None):
    if not can_access(acl if acl is not None else _acl_map(db), user.username, is_admin(user), rel):
        raise HTTPException(403, f"No access to '{top_folder(rel)}'")


def _viewers_map(db: Session) -> dict[str, set]:
    return {r.subfolder: set(r.viewers or []) for r in db.query(FolderACL).all()}


def can_write(acl: dict, viewers: dict, username: str, admin: bool, rel: str) -> bool:
    """Readable and not a view-only member of the (locked) top folder."""
    if not can_access(acl, username, admin, rel):
        return False
    return admin or username not in viewers.get(top_folder(rel), set())


def _require_write(db: Session, user: User, rel: str):
    acl = _acl_map(db)
    _require_access(db, user, rel, acl)
    if not can_write(acl, _viewers_map(db), user.username, is_admin(user), rel):
        raise HTTPException(403, f"View-only access to '{top_folder(rel)}'")


def _clean_viewers(viewers, members: list) -> list:
    return [v for v in dict.fromkeys(viewers or []) if v in members]


def _target(db: Session, path: str) -> tuple[str, Path, Path]:
    rel = normalize_rel(path)
    root = get_root(db)
    return rel, root, resolve_in_root(root, rel)


def _single_folder_name(name: str) -> str:
    sub = (name or "").replace("\\", "/").strip().strip("/")
    if not sub or "/" in sub:
        raise HTTPException(400, "Subfolder must be a single top-level name")
    return normalize_rel(sub)


def _latest_versions(db: Session, prefix: str | None = None) -> dict[str, FileVersion]:
    """Latest FileVersion per path in one query (avoids a query per file)."""
    sub = db.query(FileVersion.file_path, func.max(FileVersion.version).label("v")).group_by(FileVersion.file_path)
    if prefix:
        sub = sub.filter((FileVersion.file_path == prefix) | FileVersion.file_path.startswith(prefix + "/"))
    sub = sub.subquery()
    rows = db.query(FileVersion).join(
        sub, (FileVersion.file_path == sub.c.file_path) & (FileVersion.version == sub.c.v)).all()
    return {r.file_path: r for r in rows}


def _creators(db: Session, prefix: str) -> dict[str, str]:
    """path -> username who created version 1 (earliest version) of each file."""
    sub = (db.query(FileVersion.file_path, func.min(FileVersion.version).label("v"))
           .filter((FileVersion.file_path == prefix) | FileVersion.file_path.startswith(prefix + "/"))
           .group_by(FileVersion.file_path).subquery())
    rows = db.query(FileVersion).join(
        sub, (FileVersion.file_path == sub.c.file_path) & (FileVersion.version == sub.c.v)).all()
    return {r.file_path: r.modified_by for r in rows}


def _owns_folder(db: Session, root: Path, sub: str, username: str) -> bool:
    """True if the folder is empty/new or every file in it was created by username."""
    folder = root / sub
    if not folder.exists():
        return True
    files = [rel_of(root, p) for p in folder.rglob("*") if p.is_file()]
    if not files:
        return True
    creators = _creators(db, sub)
    return all(creators.get(f) == username for f in files)


def _file_meta(rel: str, p: Path, latest: FileVersion | None) -> dict:
    return {"name": p.name, "path": rel, "type": "file", "size": p.stat().st_size,
            "version": latest.version if latest else 0,
            "hash": latest.hash_sha256[:12] if latest else "",
            "modified_by": latest.modified_by if latest else ""}


def _ensure_sync_running():
    if scheduler.is_paused():
        raise HTTPException(423, "Sync is paused after an anomaly alert — an admin must review and resume it")


async def _guard_activity(db: Session, kind: str, size_bytes: int, actor: str, resource: str,
                          count: int = 1):
    """Feed the anomaly detector; pause sync and raise an alert on a burst."""
    anomalous, score, counts = anomaly.observe(kind, size_bytes / 1e6, count=count)
    if anomalous and not scheduler.is_paused():
        scheduler.pause()
        await event_service.emit_event(db, EventCreate(
            type="ANOMALY_DETECTED", actor="ml-engine", resource="filesystem", priority=100,
            payload={"reason": "mass file activity burst", "score": round(score, 3),
                     "window": counts, "trigger": resource, "by": actor}))


# ---------------------------------------------------------------- root
@router.get("/files/root")
def get_root_path(db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"path": str(get_root(db))}


@router.post("/files/root")
async def set_root_path(data: RootUpdate, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Move the single shared root to a new location (admin only).

    Pre-checks for name clashes, copies, verifies the file count, then removes
    the old contents and restarts the file watcher on the new root.
    """
    new_raw = (data.path or "").strip()
    if not new_raw:
        raise HTTPException(400, "Path required")
    new_root = settings.resolve_project_path(new_raw).resolve()
    if new_root == Path(new_root.anchor):
        raise HTTPException(400, "Invalid root path")
    old_root = get_root(db)
    if new_root == old_root:
        return {"ok": True, "path": str(old_root), "moved": False}
    if old_root in new_root.parents or new_root in old_root.parents:
        raise HTTPException(400, "New root cannot be inside the old root (or vice versa)")
    if new_root.exists() and not new_root.is_dir():
        raise HTTPException(400, "Target exists and is not a folder")
    clashes = [e.name for e in old_root.iterdir() if (new_root / e.name).exists()] if new_root.exists() else []
    if clashes:
        raise HTTPException(409, f"Target already contains {clashes[:5]} — merge manually")
    new_root.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    try:
        for entry in old_root.iterdir():
            dest = new_root / entry.name
            if entry.is_dir():
                shutil.copytree(entry, dest)
            else:
                shutil.copy2(entry, dest)
            copied.append(dest)
        old_files = sum(1 for p in old_root.rglob("*") if p.is_file())
        new_files = sum(1 for p in new_root.rglob("*") if p.is_file())
        if old_files != new_files:
            raise RuntimeError(f"copied {new_files} of {old_files} files")
    except Exception as e:
        for d in copied:  # roll back the partial copy
            shutil.rmtree(d, ignore_errors=True) if d.is_dir() else d.unlink(missing_ok=True)
        raise HTTPException(500, f"Move failed, old root kept ({e})")
    for entry in old_root.iterdir():
        suppress_watcher(entry, 10)
        shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
    row = db.query(RootConfig).filter(RootConfig.id == 1).first()
    if not row:
        db.add(RootConfig(id=1, path=str(new_root), updated_by=user.username))
    else:
        row.path, row.updated_by, row.updated_at = str(new_root), user.username, utcnow()
    db.commit()
    notify_root_changed(new_root)
    await event_service.emit_event(db, EventCreate(type="ROOT_MOVED", actor=user.username,
                                                   resource=str(new_root), priority=70,
                                                   payload={"from": str(old_root)}))
    return {"ok": True, "path": str(new_root), "moved": True, "files": new_files}


# ---------------------------------------------------------------- subfolders + ACL
@router.get("/files/folders")
def list_folders(db: Session = Depends(get_db), user=Depends(get_current_user)):
    root = get_root(db)
    admin = is_admin(user)
    acls = _acl_map(db)
    viewers = _viewers_map(db)
    seen = {p.name for p in root.iterdir() if p.is_dir()} | set(acls.keys())
    out = []
    for sub in sorted(seen):
        members = acls.get(sub)
        locked = members is not None
        if locked and not admin and user.username not in members:
            continue
        n_files = sum(1 for p in (root / sub).rglob("*") if p.is_file()) if (root / sub).exists() else 0
        out.append({"name": sub, "path": sub, "members": members or [], "locked": locked, "files": n_files,
                    "viewers": sorted(viewers.get(sub, set())),
                    "can_edit": admin or user.username not in viewers.get(sub, set())})
    return out


@router.post("/files/folders")
async def upsert_folder_acl(data: FolderACLUpdate, subfolder: str,
                            db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Create a subfolder and/or set its first member list."""
    sub = _single_folder_name(subfolder)
    admin = is_admin(user)
    root = get_root(db)
    existing = db.query(FolderACL).filter(FolderACL.subfolder == sub).first()
    if existing and not admin:
        raise HTTPException(403, "Admin only — folder access is already set")
    members = list(dict.fromkeys(data.members or []))
    if members and not admin and not _owns_folder(db, root, sub, user.username):
        raise HTTPException(403, "Only an admin or the user who uploaded every file here can restrict this folder")
    folder = resolve_in_root(root, sub)
    created = not folder.exists()
    folder.mkdir(parents=True, exist_ok=True)
    if not members:
        # empty = public: no ACL row (a stored empty row would lock everyone out)
        if existing:
            db.delete(existing)
            db.commit()
        if created:
            await event_service.emit_event(db, EventCreate(type="FOLDER_CREATED", actor=user.username,
                                                           resource=sub, priority=50, payload={}))
        return {"ok": True, "subfolder": sub, "members": [], "locked": False}
    for m in members:
        if not db.query(User.id).filter(User.username == m).first():
            raise HTTPException(400, f"User '{m}' does not exist")
    if not admin and user.username not in members:
        members.append(user.username)       # never lock yourself out of your own folder
    viewers = [v for v in _clean_viewers(data.viewers, members) if v != user.username or admin]
    if not existing:
        db.add(FolderACL(subfolder=sub, members=members, viewers=viewers, updated_by=user.username))
    else:
        existing.members, existing.viewers = members, viewers
        existing.updated_by, existing.updated_at = user.username, utcnow()
    db.commit()
    await event_service.emit_event(db, EventCreate(type="FOLDER_ACL_UPDATED", actor=user.username,
                                                   resource=sub, priority=60,
                                                   payload={"members": members, "viewers": viewers}))
    return {"ok": True, "subfolder": sub, "members": members, "viewers": viewers, "locked": True}


@router.post("/files/folders/{subfolder}/members")
async def update_folder_members(subfolder: str, data: FolderMembersUpdate,
                                db: Session = Depends(get_db), user=Depends(require_admin)):
    sub = _single_folder_name(subfolder)
    row = db.query(FolderACL).filter(FolderACL.subfolder == sub).first()
    members = list(row.members or []) if row else []
    for u in data.remove or []:
        if u in members:
            members.remove(u)
    for u in data.add or []:
        if not db.query(User.id).filter(User.username == u).first():
            raise HTTPException(400, f"User '{u}' does not exist")
        if u not in members:
            members.append(u)
    if not members:
        if row:
            db.delete(row)
            db.commit()
        return {"ok": True, "subfolder": sub, "members": [], "locked": False}
    current = list(row.viewers or []) if row else []
    viewers = _clean_viewers(data.view_only if data.view_only is not None else current, members)
    if not row:
        db.add(FolderACL(subfolder=sub, members=members, viewers=viewers, updated_by=user.username))
    else:
        row.members, row.viewers, row.updated_by, row.updated_at = members, viewers, user.username, utcnow()
    db.commit()
    await event_service.emit_event(db, EventCreate(type="FOLDER_ACL_UPDATED", actor=user.username,
                                                   resource=sub, priority=60,
                                                   payload={"members": members, "viewers": viewers}))
    return {"ok": True, "subfolder": sub, "members": members, "viewers": viewers, "locked": True}


@router.delete("/files/folders/{subfolder}")
async def delete_folder_acl(subfolder: str, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Remove ACL (folder becomes public). Does not delete files."""
    sub = _single_folder_name(subfolder)
    row = db.query(FolderACL).filter(FolderACL.subfolder == sub).first()
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True, "subfolder": sub, "locked": False}


@router.post("/files/folder-diff")
def folder_diff(data: FolderDiffRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Compare a local folder against the server before uploading."""
    root = get_root(db)
    admin = is_admin(user)
    acl = _acl_map(db)
    viewers = _viewers_map(db)
    out = []
    for f in data.files or []:
        try:
            rel = normalize_rel(f.path)
            target = resolve_in_root(root, rel)
        except HTTPException:
            out.append({"path": f.path, "status": "invalid", "server_size": 0})
            continue
        if not can_write(acl, viewers, user.username, admin, rel):
            out.append({"path": rel, "status": "forbidden", "server_size": 0})
            continue
        if not target.is_file():
            out.append({"path": rel, "status": "new", "server_size": 0})
            continue
        size = target.stat().st_size
        if f.size and f.size != size:
            status = "changed"
        else:
            try:
                status = "unchanged" if f.sha256 and f.sha256 == sha256_file(target) else "changed"
            except OSError:
                status = "changed"
        out.append({"path": rel, "status": status, "server_size": size})
    base_exists = False
    if data.base:
        base = data.base.replace("\\", "/").strip().strip("/")
        if base and "/" not in base:
            try:
                base_exists = resolve_in_root(root, normalize_rel(base)).exists()
            except HTTPException:
                base_exists = False
    return {"files": out, "base_exists": base_exists}


@router.delete("/files/item")
async def delete_item(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Delete a file or a top-level subfolder. Keeps audit events."""
    rel, root, target = _target(db, path)
    acl = _acl_map(db)
    _require_write(db, user, rel)
    if not target.exists():
        raise HTTPException(404, "Not found")
    admin = is_admin(user)
    is_dir = target.is_dir()
    if is_dir and "/" in rel:
        raise HTTPException(400, "Only top-level subfolders can be deleted")
    if is_dir:
        if not admin and not _owns_folder(db, root, rel, user.username):
            raise HTTPException(403, "Only an admin or the user who created every file in it can delete this folder")
    else:
        creator = _creators(db, rel).get(rel)
        in_locked = top_folder(rel) in acl
        if not (admin or creator == user.username or in_locked):
            raise HTTPException(403, "Only the file's creator or an admin can delete it")

    vq = db.query(FileVersion).filter(
        (FileVersion.file_path == rel) | (FileVersion.file_path.startswith(rel + "/"))
        if is_dir else (FileVersion.file_path == rel))
    shas = {v.hash_sha256 for v in vq.all()}
    if is_dir:
        n_files = sum(1 for p in target.rglob("*") if p.is_file())
        for p in target.rglob("*"):
            suppress_watcher(p, 10)
        shutil.rmtree(target)
        threads = db.query(FileThread).filter(
            (FileThread.file_path == rel) | (FileThread.file_path.startswith(rel + "/"))).all()
        acl_row = db.query(FolderACL).filter(FolderACL.subfolder == rel).first()
        if acl_row:
            db.delete(acl_row)
    else:
        suppress_watcher(target, 10)
        target.unlink()
        n_files = 1
        threads = db.query(FileThread).filter(FileThread.file_path == rel).all()
    vq.delete(synchronize_session=False)
    for th in threads:
        db.query(FileComment).filter(FileComment.thread_id == th.id).delete()
        db.delete(th)
    db.commit()
    gc_blobs(db, shas)
    await event_service.emit_event(db, EventCreate(type="FILE_DELETED", actor=user.username,
                                                   resource=rel, priority=60,
                                                   payload={"was_dir": is_dir, "files": n_files}))
    if not admin:  # an admin's explicit folder delete is not a ransomware burst
        await _guard_activity(db, "deleted", 0, user.username, rel, count=n_files)
    return {"ok": True, "path": rel, "was_dir": is_dir, "files": n_files}


# ---------------------------------------------------------------- tree + files
@router.get("/files/tree")
def get_tree(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Nested root tree filtered by the caller's access."""
    root = get_root(db)
    admin = is_admin(user)
    acls = _acl_map(db)
    viewers_all = _viewers_map(db)
    latest = _latest_versions(db)

    def visible_sub(sub: str) -> bool:
        return sub not in acls or admin or user.username in (acls[sub] or [])

    tree: dict = {"name": "root", "path": "", "type": "dir", "children": []}
    dirs: dict = {"": tree}
    for sub in sorted(acls):
        if not visible_sub(sub):
            continue
        vw = viewers_all.get(sub, set())
        node = {"name": sub, "path": sub, "type": "dir", "locked": True, "members": acls[sub],
                "viewers": sorted(vw), "can_edit": admin or user.username not in vw, "children": []}
        tree["children"].append(node)
        dirs[sub] = node
    for p in sorted(root.rglob("*")):
        rel = rel_of(root, p)
        top = rel.split("/")[0]
        if "/" in rel or p.is_dir():
            if not visible_sub(top):
                continue
        parent_rel = rel.rsplit("/", 1)[0] if "/" in rel else ""
        parent = dirs.get(parent_rel)
        if parent is None:
            continue
        if p.is_dir():
            if rel in dirs:
                continue
            node = {"name": p.name, "path": rel, "type": "dir", "children": []}
            parent["children"].append(node)
            dirs[rel] = node
        elif p.is_file():
            parent["children"].append(_file_meta(rel, p, latest.get(rel)))
    return tree


@router.get("/files")
def list_files(subfolder: str | None = None, db: Session = Depends(get_db), user=Depends(get_current_user)):
    root = get_root(db)
    admin = is_admin(user)
    acl = _acl_map(db)
    prefix = normalize_rel(subfolder) if subfolder else None
    latest = _latest_versions(db, prefix)
    base = resolve_in_root(root, prefix) if prefix else root
    if not base.exists():
        return []
    out = []
    for p in sorted(base.rglob("*")):
        if not p.is_file():
            continue
        rel = rel_of(root, p)
        if not can_access(acl, user.username, admin, rel):
            continue
        meta = _file_meta(rel, p, latest.get(rel))
        meta.pop("type")
        out.append(meta)
    return out


@router.get("/files/versions")
def versions(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = normalize_rel(path)
    _require_access(db, user, rel)
    rows = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(FileVersion.version).all()
    return [{"version": r.version, "hash": r.hash_sha256, "size": r.size,
             "by": r.modified_by, "at": r.timestamp.isoformat(),
             "chunks": r.chunks, "clock": r.vector_clock,
             "restorable": blob_path(r.hash_sha256).exists()} for r in rows]


@router.get("/files/activity")
def file_activity(path: str = "", db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Audit log for a file or subfolder, filtered to what the caller may see."""
    rel = "" if path in ("", "root", "/") else normalize_rel(path)
    if rel:
        _require_access(db, user, rel)
    q = db.query(Event)
    if rel:
        q = q.filter((Event.resource == rel) | (Event.resource.startswith(rel + "/")) |
                     (Event.resource.contains(f" file:{rel}")))
    rows = visible_events(db, user, q.order_by(Event.timestamp.desc()), 200)
    return [{"id": e.id, "type": e.type, "actor": e.actor, "resource": e.resource,
             "priority": e.priority, "payload": e.payload,
             "timestamp": e.timestamp.isoformat()} for e in rows]


# ---------------------------------------------------------------- per-file discussions
def _get_thread(db: Session, rel: str) -> FileThread | None:
    return db.query(FileThread).filter(FileThread.file_path == rel).first()


@router.get("/files/discussion")
def get_discussion(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel = normalize_rel(path)
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
    rel = normalize_rel(data.file_path)
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
        "id": c.id, "sender": c.sender, "content": c.content, "created_at": c.created_at.isoformat()}}


# ---------------------------------------------------------------- sync
@router.get("/sync/manifest")
def manifest(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel, _, target = _target(db, path)
    _require_access(db, user, rel)
    latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
        FileVersion.version.desc()).first()
    base = {"version": latest.version if latest else 0,
            "clock": latest.vector_clock if latest else {},
            "chunk_size": settings.chunk_size}
    if not target.is_file():
        return {"exists": False, "chunks": [], "size": 0, **base}
    return {"exists": True, "chunks": chunk_file(target), "size": target.stat().st_size,
            "sha256": sha256_file(target), **base}


@router.post("/sync/chunk")
async def upload_chunk(file: UploadFile, path: str, response: Response,
                       index: int = Query(0, ge=0), total: int = Query(1, ge=1),
                       upload_id: str = Query("", max_length=64),
                       db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Stage one chunk at its offset. Nothing reaches the root until /sync/complete."""
    rel, _, target = _target(db, path)
    _require_write(db, user, rel)
    _ensure_sync_running()
    if index >= total:
        raise HTTPException(400, "index must be < total")
    if target.is_dir():
        raise HTTPException(409, "A folder exists at this path")
    data = await file.read()
    if len(data) > settings.chunk_size:
        raise HTTPException(413, f"Chunk larger than {settings.chunk_size} bytes")
    stage = staging_path(user.username, rel, upload_id)
    # index 0 always opens a fresh session for legacy clients that send no upload_id
    write_chunk(stage, target, index, data, fresh=(index == 0 and not upload_id))

    # Apply Token Bucket QoS shaping (Priority 40 for background bulk chunk sync)
    tb_result = await scheduler.token_bucket.consume(tokens=1.0, priority=40)
    is_cong = tb_result["congested"]
    response.headers["X-Congestion"] = "1" if is_cong else "0"

    return {
        "ok": True,
        "chunk": index,
        "of": total,
        "sha": hashlib.sha256(data).hexdigest(),
        "congested": is_cong,
        "delay_ms": tb_result["delay_ms"],
        "tokens_remaining": tb_result["tokens_remaining"],
    }


@router.post("/sync/complete")
async def sync_complete(path: str, body: SyncComplete | None = Body(default=None),
                        upload_id: str = Query("", max_length=64),
                        db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Finalize an upload: assemble, version, detect conflicts, store the blob."""
    rel, _, target = _target(db, path)
    _require_write(db, user, rel)
    _ensure_sync_running()
    body = body or SyncComplete()
    stage = staging_path(user.username, rel, upload_id)
    if stage.exists():
        if body.size is not None:
            with open(stage, "r+b") as f:
                f.truncate(body.size)
        src = stage
    elif target.is_file():
        src = target                 # every chunk was deduplicated
    else:
        raise HTTPException(404, "No uploaded data for this path")

    sha = sha256_file(src)
    size = src.stat().st_size
    latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
        FileVersion.version.desc()).first()
    if latest and latest.hash_sha256 == sha:
        if src is stage:
            stage.unlink(missing_ok=True)
        return {"ok": True, "deduped": True, "version": latest.version, "sha": sha,
                "clock": latest.vector_clock}

    conflict = False
    if latest is None:
        base_clock: dict = {}
    elif body.base_version is not None:
        # The client tells us which version its edit started from.
        base_row = db.query(FileVersion).filter(FileVersion.file_path == rel,
                                                FileVersion.version == body.base_version).first()
        base_clock = base_row.vector_clock if base_row else {}
        conflict = body.base_version != latest.version
    elif body.clock:
        base_clock = body.clock
        conflict = detect_conflict(latest.vector_clock or {}, body.clock)
    else:
        base_clock = latest.vector_clock or {}   # legacy client: last writer wins
    clock = bump_clock(merge_clocks(base_clock, latest.vector_clock if latest else {}), user.username)

    if src is stage:
        place_file(stage, target)
    store_blob(target, sha)
    chunks = chunk_file(target)
    version = (latest.version + 1) if latest else 1
    db.add(FileVersion(file_path=rel, version=version, hash_sha256=sha, chunks=chunks,
                       size=size, modified_by=user.username, vector_clock=clock))
    db.commit()

    etype = "VERSION_CONFLICT" if conflict else ("FILE_MODIFIED" if latest else "FILE_CREATED")
    await event_service.emit_event(db, EventCreate(
        type=etype, actor=user.username, resource=rel, priority=90 if conflict else 60,
        payload={"version": version, "sha": sha[:16], "size": size, "chunks": len(chunks),
                 "conflict": conflict, "base_version": body.base_version,
                 "against_version": latest.version if latest else 0}, vector_clock=clock))
    await _guard_activity(db, "modified" if latest else "created", size, user.username, rel)
    return {"ok": True, "version": version, "sha": sha, "conflict": conflict,
            "chunks": len(chunks), "clock": clock}


@router.get("/sync/download")
def download_chunk(path: str, index: int = Query(0, ge=0),
                   chunk_size: int = Query(1_048_576, ge=1, le=MAX_DOWNLOAD_CHUNK),
                   db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel, _, target = _target(db, path)
    _require_access(db, user, rel)
    if not target.is_file():
        raise HTTPException(404, "Not found")
    with open(target, "rb") as f:
        f.seek(index * chunk_size)
        data = f.read(chunk_size)
    return Response(content=data, media_type="application/octet-stream",
                    headers={"X-Chunk": str(index), "X-SHA": hashlib.sha256(data).hexdigest()})


@router.get("/sync/inspect")
def inspect(path: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    rel, _, target = _target(db, path)
    _require_access(db, user, rel)
    if not target.is_file():
        raise HTTPException(404, "Not found")
    return {"sha256": sha256_file(target), "chunks": chunk_file(target), "size": target.stat().st_size}


@router.post("/sync/report-activity")
async def report_activity(n_modified: int = Query(0, ge=0), n_deleted: int = Query(0, ge=0),
                          n_created: int = Query(0, ge=0), total_mb: float = Query(0.0, ge=0),
                          db: Session = Depends(get_db), user=Depends(require_admin)):
    """Score a hypothetical activity window (admin drill). Never used for training."""
    anomalous, score = anomaly.is_anomalous(n_modified, n_deleted, n_created, total_mb)
    if anomalous:
        scheduler.pause()
        await event_service.emit_event(db, EventCreate(
            type="ANOMALY_DETECTED", actor=user.username, resource="filesystem",
            priority=100, payload={"modified": n_modified, "deleted": n_deleted,
                                   "created": n_created, "mb": total_mb, "score": score,
                                   "reason": "reported activity window"}))
        return {"anomaly": True, "action": "sync paused, versions preserved", "score": score}
    return {"anomaly": False, "score": score}


@router.post("/files/reveal")
def reveal_in_browser(path: str | None = None, db: Session = Depends(get_db), user=Depends(require_admin)):
    """Open root (or a file/subfolder) in the *server's* file browser (admin only)."""
    root = get_root(db)
    target = root
    if path:
        rel, _, target = _target(db, path)
        if not target.exists():
            raise HTTPException(404, "Not found")
    try:
        if sys.platform == "darwin":
            cmd = ["open", "-R", str(target)] if target.is_file() else ["open", str(target)]
        elif sys.platform == "win32":
            cmd = ["explorer", f"/select,{target}"] if target.is_file() else ["explorer", str(target)]
        else:
            folder = str(target if target.is_dir() else target.parent)
            opener = shutil.which("xdg-open") or shutil.which("gio")
            if not opener:
                raise RuntimeError("no xdg-open/gio on server")
            cmd = [opener, folder] if "xdg" in opener else [opener, "open", folder]
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:
        raise HTTPException(500, f"Cannot open file browser on server ({e}). Path: {target}")
    return {"ok": True, "path": str(target)}


@router.get("/files/download")
def download_file(path: str, version: int | None = None, db: Session = Depends(get_db),
                  user=Depends(get_current_user)):
    rel, _, target = _target(db, path)
    _require_access(db, user, rel)
    if version is not None:
        row = db.query(FileVersion).filter(FileVersion.file_path == rel, FileVersion.version == version).first()
        if not row or not blob_path(row.hash_sha256).exists():
            raise HTTPException(404, "Version content not available")
        return FileResponse(str(blob_path(row.hash_sha256)), filename=f"v{version}_{target.name}")
    if not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(str(target), filename=target.name)


@router.post("/files/resolve")
async def resolve_conflict(path: str, strategy: str = "latest", version: int | None = None,
                           db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Resolve a VERSION_CONFLICT by restoring real content.

    strategy=latest     keep the current file (records the decision)
    strategy=keep-mine  restore the caller's most recent version
    strategy=version    restore ``version``
    A restore writes the chosen bytes back and commits them as a new version.
    """
    rel, _, target = _target(db, path)
    _require_write(db, user, rel)
    _ensure_sync_running()
    rows = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
        FileVersion.version.desc()).all()
    if not rows:
        raise HTTPException(404, "No versions for path")
    latest = rows[0]
    if strategy == "latest":
        winner = latest
    elif strategy == "keep-mine":
        winner = next((r for r in rows if r.modified_by == user.username), None)
        if winner is None:
            raise HTTPException(404, "You have no version of this file")
    elif strategy == "version":
        winner = next((r for r in rows if r.version == version), None)
        if winner is None:
            raise HTTPException(404, f"Version {version} not found")
    else:
        raise HTTPException(400, "strategy must be latest | keep-mine | version")

    restored = False
    new_version = latest.version
    if winner.hash_sha256 != latest.hash_sha256:
        blob = blob_path(winner.hash_sha256)
        if not blob.exists():
            raise HTTPException(409, f"Content of v{winner.version} was not preserved (uploaded before version storage)")
        tmp = staging_path(user.username, rel, "restore")
        shutil.copyfile(blob, tmp)
        place_file(tmp, target)
        new_version = latest.version + 1
        clock = bump_clock(merge_clocks(*(r.vector_clock or {} for r in rows)), user.username)
        # authorship of restored content stays with its author (the restore
        # itself is recorded in the FILE_CONFLICT_RESOLVED event)
        db.add(FileVersion(file_path=rel, version=new_version, hash_sha256=winner.hash_sha256,
                           chunks=winner.chunks, size=winner.size, modified_by=winner.modified_by,
                           vector_clock=clock))
        db.commit()
        restored = True
    await event_service.emit_event(db, EventCreate(
        type="FILE_CONFLICT_RESOLVED", actor=user.username, resource=rel, priority=70,
        payload={"strategy": strategy, "winner_version": winner.version, "winner_by": winner.modified_by,
                 "restored": restored, "new_version": new_version, "sha": winner.hash_sha256[:16]}))
    return {"ok": True, "winner_version": winner.version, "by": winner.modified_by,
            "restored": restored, "version": new_version}


@router.post("/sync/resume-scheduler")
async def resume_scheduler(db: Session = Depends(get_db), user=Depends(require_admin)):
    anomaly.acknowledge_current()
    scheduler.resume()
    await event_service.emit_event(db, EventCreate(type="SYNC_RESUMED", actor=user.username,
                                                   resource="scheduler", priority=60,
                                                   payload={"action": "resumed"}))
    return {"ok": True}


# ---------------------------------------------------------------- disk changes (watcher)
def index_untracked(db: Session, root: Path) -> int:
    """Give every file already on disk without a version a v1 (startup baseline),
    so it shows real metadata and can be restored after later edits."""
    known = {p for (p,) in db.query(FileVersion.file_path).distinct().all()}
    n = 0
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        rel = rel_of(root, p)
        if rel in known:
            continue
        try:
            sha = sha256_file(p)
            store_blob(p, sha)
            db.add(FileVersion(file_path=rel, version=1, hash_sha256=sha, chunks=chunk_file(p),
                               size=p.stat().st_size, modified_by="local-disk",
                               vector_clock={"local-disk": 1}))
            n += 1
        except OSError:
            continue
    if n:
        db.commit()
    return n


def record_disk_change(db: Session, root: Path, abs_path: str, etype: str):
    """Called from the watcher thread for edits made directly on the server's disk.

    Returns (event, anomaly_tuple) — the caller emits.
    """
    p = Path(abs_path)
    try:
        rel = rel_of(root, p.resolve() if p.exists() else p)
    except ValueError:
        return None, None
    size = 0
    if etype != "FILE_DELETED" and p.is_file():
        size = p.stat().st_size
        sha = sha256_file(p)
        latest = db.query(FileVersion).filter(FileVersion.file_path == rel).order_by(
            FileVersion.version.desc()).first()
        if not latest or latest.hash_sha256 != sha:
            store_blob(p, sha)
            clock = bump_clock(latest.vector_clock if latest else {}, "local-disk")
            db.add(FileVersion(file_path=rel, version=(latest.version + 1) if latest else 1,
                               hash_sha256=sha, chunks=chunk_file(p), size=size,
                               modified_by="local-disk", vector_clock=clock))
            db.commit()
        elif latest:
            return None, None          # content unchanged (touch / metadata change)
    kind = {"FILE_CREATED": "created", "FILE_DELETED": "deleted"}.get(etype, "modified")
    ev = event_service.emit_event_sync(db, EventCreate(
        type=etype, actor="local-disk", resource=rel, priority=60, payload={"size": size}))
    return ev, anomaly.observe(kind, size / 1e6)

