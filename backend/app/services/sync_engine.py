"""SHA-256 chunking, dedup, version + vector-clock conflict detection."""

import hashlib
from pathlib import Path

from app.core.config import settings
from app.services.storage import sha256_file  # noqa: F401  (re-exported)


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


def dominates(a: dict, b: dict) -> bool:
    """a >= b component-wise (a has seen everything b has)."""
    return all(a.get(k, 0) >= v for k, v in (b or {}).items())


def detect_conflict(local_clock: dict, remote_clock: dict) -> bool:
    """True if neither clock dominates (concurrent edit)."""
    return not (dominates(local_clock or {}, remote_clock or {}) or
                dominates(remote_clock or {}, local_clock or {}))


def merge_clocks(*clocks: dict) -> dict:
    out: dict = {}
    for c in clocks:
        for k, v in (c or {}).items():
            out[k] = max(out.get(k, 0), int(v))
    return out


def bump_clock(clock: dict, node_id: str) -> dict:
    clock = dict(clock or {})
    clock[node_id] = clock.get(node_id, 0) + 1
    return clock
