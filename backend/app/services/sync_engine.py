"""SHA-256 chunking, dedup, version + vector-clock conflict detection."""

import hashlib
from pathlib import Path

from app.core.config import settings


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(65536), b""):
            h.update(b)
    return h.hexdigest()


def chunk_file(path: str | Path, chunk_size: int | None = None) -> list[dict]:
    chunk_size = chunk_size or settings.chunk_size
    chunks = []
    with open(path, "rb") as f:
        idx = 0
        while True:
            data = f.read(chunk_size)
            if not data:
                break
            chunks.append({"index": idx, "hash": hashlib.sha256(data).hexdigest(), "size": len(data)})
            idx += 1
    return chunks


def detect_conflict(local_clock: dict, remote_clock: dict) -> bool:
    """True if neither clock dominates (concurrent edit)."""
    l_dom = all(local_clock.get(k, 0) >= v for k, v in remote_clock.items())
    r_dom = all(remote_clock.get(k, 0) >= v for k, v in local_clock.items())
    return not (l_dom or r_dom)


def bump_clock(clock: dict, node_id: str) -> dict:
    clock = dict(clock)
    clock[node_id] = clock.get(node_id, 0) + 1
    return clock
