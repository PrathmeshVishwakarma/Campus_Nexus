"""Priority scheduler — heapq based, network-aware QoS + TokenBucket traffic shaper.

Critical(100) > Message(80) > Metadata(60) > Sync(40) > Backup(10)
Congestion: when tx bytes/sec exceeds threshold or simulated congestion is tripped,
low-priority (<60) tasks are deferred, and TokenBucket rate-limiting shapes bulk traffic.
"""

import asyncio
import heapq
import itertools
import time

_counter = itertools.count()
_queue: list = []  # (neg_priority, seq, coro_fn, label)
_paused = False
_last_bytes = 0
_last_t = 0.0
_bps = 0.0
CONGESTION_BPS = 5_000_000  # ~5 MB/s


class TokenBucket:
    """Token Bucket Traffic Shaper and QoS Rate Limiter (DiffServ-inspired).

    - rate: Tokens generated per second (e.g. 5 tokens/sec = 5 MB/s sustained at 1MB chunk)
    - capacity: Maximum bucket capacity for bursts (e.g. 10 tokens)
    - simulated_congestion: Manual override toggle for demonstrations and stress testing
    """

    def __init__(self, rate: float = 5.0, capacity: float = 10.0):
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last_update = time.time()
        self.simulated_congestion = False

    def _refill(self):
        now = time.time()
        elapsed = max(0.0, now - self.last_update)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last_update = now

    def is_congested(self) -> bool:
        if self.simulated_congestion:
            return True
        return _bps > CONGESTION_BPS

    async def consume(self, tokens: float = 1.0, priority: int = 50) -> dict:
        """Consume tokens for a transmission.

        High priority (>= 80, e.g. Alerts/DMs) bypasses the bucket with zero delay.
        Bulk transfers (< 60, e.g. File Chunks) are throttled when bucket is depleted
        or when the network is congested.
        """
        # VIP traffic bypasses queuing delay
        if priority >= 80:
            return {
                "allowed": True,
                "congested": False,
                "delay_ms": 0.0,
                "tokens_remaining": round(self.tokens, 2),
                "bypassed": True,
            }

        self._refill()
        congested = self.is_congested()

        # If network is congested or bucket has insufficient tokens:
        if congested or self.tokens < tokens:
            wait_time = max(0.25, (tokens - self.tokens) / self.rate if self.tokens < tokens else 0.25)
            await asyncio.sleep(wait_time)
            self._refill()
            self.tokens = max(0.0, self.tokens - tokens)
            return {
                "allowed": True,
                "congested": True,
                "delay_ms": round(wait_time * 1000.0, 1),
                "tokens_remaining": round(self.tokens, 2),
                "bypassed": False,
            }

        self.tokens -= tokens
        return {
            "allowed": True,
            "congested": False,
            "delay_ms": 0.0,
            "tokens_remaining": round(self.tokens, 2),
            "bypassed": False,
        }

    def status(self) -> dict:
        self._refill()
        return {
            "rate": self.rate,
            "capacity": self.capacity,
            "tokens": round(self.tokens, 2),
            "simulated_congestion": self.simulated_congestion,
            "is_congested": self.is_congested(),
        }

    def set_simulated_congestion(self, enabled: bool):
        self.simulated_congestion = enabled


token_bucket = TokenBucket()


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
    tb_stat = token_bucket.status()
    is_cong = (_bps > CONGESTION_BPS) or tb_stat["simulated_congestion"]
    return {
        "bps": round(_bps, 1),
        "congested": is_cong,
        "threshold": CONGESTION_BPS,
        "paused": _paused,
        "token_bucket": tb_stat,
    }


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

