"""Shared-root paths, upload staging and the content-addressed version store.

* All client paths are normalised to POSIX-style relative paths and must
  resolve inside the root (no ``..``, drive letters, absolute paths, symlink
  escapes). Using ``/`` everywhere keeps ACL checks identical on every OS.
* Uploads are assembled in a private staging file outside the root and moved
  into place atomically on completion, so watchers and readers never see a
  half-written file.
* Every committed version's bytes are kept in ``data_dir/blobs/<sha256>`` so
  conflicts can be resolved by restoring real content.
"""

import hashlib
import os
import re
import shutil
import threading
import time
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.models import FileVersion, RootConfig

_BAD_CHARS = re.compile(r'[\x00-\x1f<>:"|?*]')
_root_listeners: list = []


# ---------------------------------------------------------------- root
def default_root() -> Path:
    return settings.resolve_project_path(settings.shared_folder)


def get_root(db: Session) -> Path:
    row = db.query(RootConfig).filter(RootConfig.id == 1).first()
    root = settings.resolve_project_path(row.path) if (row and row.path) else default_root()
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def on_root_changed(fn):
    """Register fn(new_root: Path) — called after the admin moves the root."""
    _root_listeners.append(fn)


def notify_root_changed(new_root: Path):
    for fn in list(_root_listeners):
        try:
            fn(new_root)
        except Exception as e:  # pragma: no cover
            print("[storage] root listener failed:", e)


# ---------------------------------------------------------------- paths
def normalize_rel(path: str) -> str:
    """Normalise a client path to 'a/b/c'. Raises 400 on anything unsafe."""
    raw = (path or "").replace("\\", "/").strip()
    if not raw or raw.startswith("/") or _BAD_CHARS.search(raw):
        raise HTTPException(400, "Invalid path")
    parts = [p for p in raw.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise HTTPException(400, "Invalid path")
    if any(p != p.strip() or p.endswith(".") for p in parts):
        # Windows silently strips trailing dots/spaces -> two names, one file
        raise HTTPException(400, "Invalid path")
    return "/".join(parts)


def resolve_in_root(root: Path, rel: str) -> Path:
    target = (root / PurePosixPath(rel)).resolve()
    root_r = root.resolve()
    if target != root_r and root_r not in target.parents:
        raise HTTPException(400, "Path escapes the shared root")
    return target


def rel_of(root: Path, p: Path) -> str:
    return p.relative_to(root).as_posix()


# ---------------------------------------------------------------- hashing
def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 16), b""):
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- staging
def _key(*parts: str) -> str:
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:32]


def staging_path(username: str, rel: str, upload_id: str = "") -> Path:
    d = settings.data_path / "staging"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{_key(username, rel, upload_id or 'default')}.part"


def write_chunk(stage: Path, base: Path | None, index: int, data: bytes, fresh: bool):
    """Write one chunk at its offset. The staging file starts as a copy of the
    current file so chunks the client skipped (deduplicated) keep their bytes."""
    if fresh or not stage.exists():
        if base is not None and base.exists():
            shutil.copyfile(base, stage)
        else:
            stage.write_bytes(b"")
    with open(stage, "r+b") as f:
        f.seek(index * settings.chunk_size)
        f.write(data)


def cleanup_stale_staging(max_age_s: int = 24 * 3600):
    d = settings.data_path / "staging"
    if not d.exists():
        return
    now = time.time()
    for p in d.glob("*.part"):
        try:
            if now - p.stat().st_mtime > max_age_s:
                p.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- blobs
def blob_path(sha: str) -> Path:
    return settings.data_path / "blobs" / sha[:2] / sha


def store_blob(src: Path, sha: str):
    dst = blob_path(sha)
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def gc_blobs(db: Session, shas: set[str]):
    """Delete blobs no FileVersion references any more."""
    for sha in shas:
        if not sha:
            continue
        if db.query(FileVersion.id).filter(FileVersion.hash_sha256 == sha).first():
            continue
        try:
            blob_path(sha).unlink()
        except OSError:
            pass


# ---------------------------------------------------------------- write suppression
_suppress_lock = threading.Lock()
_suppressed: dict[str, float] = {}


def suppress_watcher(path: Path, seconds: float = 3.0):
    """Mark a path as written by the API so the file watcher ignores the echo."""
    with _suppress_lock:
        _suppressed[str(Path(path).resolve())] = time.time() + seconds


def is_suppressed(path: str | Path) -> bool:
    key = str(Path(path).resolve())
    now = time.time()
    with _suppress_lock:
        for k in [k for k, t in _suppressed.items() if t < now]:
            _suppressed.pop(k, None)
        return key in _suppressed


def place_file(src: Path, target: Path):
    """Atomically move a finished file into the root (suppressing the watcher)."""
    target.parent.mkdir(parents=True, exist_ok=True)
    suppress_watcher(target)
    os.replace(src, target)
