"""UDP broadcast peer discovery + zeroconf mDNS."""

import json
import socket
import threading

DISCOVERY_MSG = "CAMPUS_NEXUS_HELLO"


def broadcast_hello(port: int = 9999):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.sendto(json.dumps({"msg": DISCOVERY_MSG, "host": socket.gethostname()}).encode(),
             ("<broadcast>", port))
    s.close()


def listen_hello(port: int = 9999, on_peer=None):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", port))
    except OSError:
        return
    s.settimeout(2.0)
    while True:
        try:
            data, addr = s.recvfrom(1024)
            payload = json.loads(data.decode())
            if payload.get("msg") == DISCOVERY_MSG and on_peer:
                on_peer(payload.get("host", "unknown"), addr[0])
        except (socket.timeout, ValueError, OSError):
            continue


def start_listener_thread(port: int = 9999, on_peer=None):
    t = threading.Thread(target=listen_hello, args=(port, on_peer), daemon=True)
    t.start()
    return t


def register_mdns(hostname: str, port: int = 8000):
    """Best-effort zeroconf registration; skipped if lib missing."""
    try:
        from zeroconf import ServiceInfo, Zeroconf
        zc = Zeroconf()
        info = ServiceInfo("_campus-nexus._tcp.local.", f"{hostname}._campus-nexus._tcp.local.",
                           addresses=[socket.inet_aton("127.0.0.1")], port=port,
                           properties={"node": hostname})
        zc.register_service(info)
        return zc
    except Exception as e:
        print(f"[discovery] mDNS skipped: {e}")
        return None
