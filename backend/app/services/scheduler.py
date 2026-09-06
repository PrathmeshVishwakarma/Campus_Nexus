"""Priority scheduler — heapq based, network-aware.

Critical(100) > Message(80) > Metadata(60) > Sync(40) > Backup(10)
Congestion: when tx bytes/sec exceeds threshold, low-priority (<60)
tasks are deferred one cycle so alerts/messages jump ahead.
"""

import asyncio
import heapq
import itertools

_counter = itertools.count()
_queue: list = []  # (neg_priority, seq, coro_fn, label)
_paused = False
_last_bytes = 0
_last_t = 0.0
_bps = 0.0
CONGESTION_BPS = 5_000_000  # ~5 MB/s


def enqueue(priority: int, label: str, coro_fn):
    heapq.heappush(_queue, (-priority, next(_counter), label, coro_fn))


def pause():
    global _paused
    _paused = True


def resume():
    global _paused
    _paused = False


def is_paused() -> bool:
    return _paused


def pending() -> list[dict]:
    return [{"priority": -p, "label": label} for (p, _, label, _) in sorted(_queue)]


def throttle_status() -> dict:
    try:
        import time
        import psutil
        global _last_bytes, _last_t, _bps
        c = psutil.net_io_counters()
        now = time.time()
        if _last_t:
            dt = max(now - _last_t, 0.01)
            _bps = (c.bytes_sent - _last_bytes) / dt
        _last_bytes, _last_t = c.bytes_sent, now
    except Exception:
        pass
    return {"bps": round(_bps, 1), "congested": _bps > CONGESTION_BPS,
            "threshold": CONGESTION_BPS, "paused": _paused}


async def scheduler_loop(interval: float = 0.5):
    while True:
        if not _paused and _queue:
            status = throttle_status()
            neg_prio, seq, label, coro_fn = _queue[0]
            if status["congested"] and -neg_prio < 60:
                # defer bulk sync one cycle; re-check next tick
                await asyncio.sleep(interval)
                continue
            heapq.heappop(_queue)
            try:
                if asyncio.iscoroutinefunction(coro_fn):
                    await coro_fn()
                else:
                    coro_fn()
            except Exception as e:
                print(f"[scheduler] task {label} failed: {e}")
        await asyncio.sleep(interval)
