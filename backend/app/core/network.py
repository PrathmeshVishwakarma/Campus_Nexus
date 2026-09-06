"""Network health helpers — latency / bandwidth via psutil + socket."""

import socket
import time

import psutil


def ping_host(host: str, port: int = 80, timeout: float = 1.0) -> float | None:
    """TCP connect latency in ms, None if unreachable."""
    start = time.time()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return round((time.time() - start) * 1000, 2)
    except OSError:
        return None


def net_io_snapshot() -> dict:
    c = psutil.net_io_counters()
    return {"bytes_sent": c.bytes_sent, "bytes_recv": c.bytes_recv}


def is_congested(bytes_sent_per_sec: float, threshold: float = 5_000_000) -> bool:
    return bytes_sent_per_sec > threshold
