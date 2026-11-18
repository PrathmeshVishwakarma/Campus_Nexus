"""Standalone Campus Nexus node agent — stdlib only (no FastAPI/watchdog deps).

Watches a folder by polling, heartbeats to the server, and uploads changed
files in 1 MB chunks with SHA-256 dedup via /sync/manifest.

Conflict detection: the agent remembers which server version each local file
was last synced from and sends it as ``base_version``. If someone else committed
a newer version in between, the server records a VERSION_CONFLICT (both
versions are kept and can be restored from the Files page).

Usage:
  python agent.py --folder ../shared/my_copy --server http://localhost:8000 --username node1
  (password from --password, $NEXUS_PASSWORD, or an interactive prompt)
"""

import argparse
import getpass
import hashlib
import http.client
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

CHUNK = 1024 * 1024
HELLO_PORT = 9999
STATE_FILE = ".nexus_agent_state.json"

# AIMD Congestion Control Parameters (RFC 5681 inspired)
AIMD_CONGESTION_DELAY = 0.0      # Current inter-chunk backoff delay (seconds)
AIMD_RTT_THRESHOLD_MS = 250.0    # RTT threshold indicating bufferbloat / link saturation
AIMD_MIN_DELAY = 0.0
AIMD_MAX_DELAY = 3.0


class AuthError(RuntimeError):
    pass


def api(server, method, path, token=None, body=None, query=""):
    url = server.rstrip("/") + path + query
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        if e.code == 401:
            raise AuthError(detail)
        raise RuntimeError(f"{method} {path} -> {e.code}: {detail}")


def login(server, username, password):
    data = urllib.parse.urlencode({"username": username, "password": password}).encode()
    req = urllib.request.Request(server.rstrip("/") + "/api/auth/login", data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())["access_token"]


def post_multipart(server, path, query, token, field_name, filename, chunk_bytes):
    boundary = uuid.uuid4().hex
    safe_name = filename.replace('"', "_").replace("\r", "_").replace("\n", "_")
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field_name}\"; "
            f"filename=\"{safe_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() \
        + chunk_bytes + f"\r\n--{boundary}--\r\n".encode()
    u = urllib.parse.urlparse(server.rstrip("/") + path + query)
    conn_cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(u.hostname, u.port or (443 if u.scheme == "https" else 80), timeout=60)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}",
               "Content-Length": str(len(body))}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        conn.request("POST", u.path + ("?" + u.query if u.query else ""), body, headers)
        resp = conn.getresponse()
        ecn_header = resp.getheader("X-Congestion", "0")
        data = resp.read().decode()
    finally:
        conn.close()
    if resp.status == 401:
        raise AuthError(data[:200])
    if resp.status >= 400:
        raise RuntimeError(f"chunk upload {resp.status}: {data[:200]}")
    res = json.loads(data or "{}")
    if ecn_header == "1":
        res["congested"] = True
    return res


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def q(rel: str) -> str:
    return urllib.parse.quote(rel, safe="")


def upload_file(server, token, folder: Path, rel: str, base_version: int | None):
    """Upload one file; returns the server's response to /sync/complete."""
    global AIMD_CONGESTION_DELAY
    data = (folder / rel).read_bytes()
    total = max(1, -(-len(data) // CHUNK))
    man = api(server, "GET", "/api/sync/manifest", token, query=f"?path={q(rel)}")
    existing = [c["hash"] for c in (man.get("chunks") or [])] if man.get("exists") else []
    if base_version is None:
        # first time we see this file: our copy is based on whatever the server has
        base_version = man.get("version") or None
    upload_id = uuid.uuid4().hex
    for i in range(total):
        piece = data[i * CHUNK:(i + 1) * CHUNK]
        if i < len(existing) and existing[i] == sha(piece):
            continue

        t0 = time.time()
        chunk_res = post_multipart(server, "/api/sync/chunk",
                                   f"?path={q(rel)}&index={i}&total={total}&upload_id={upload_id}",
                                   token, "file", Path(rel).name, piece)
        rtt_ms = (time.time() - t0) * 1000.0

        # Congestion detection via Explicit Congestion Notification (ECN) or high RTT
        is_congested = chunk_res.get("congested", False) or (rtt_ms > AIMD_RTT_THRESHOLD_MS)
        if is_congested:
            # Multiplicative Decrease: throttle aggressively to clear queue
            AIMD_CONGESTION_DELAY = min(AIMD_MAX_DELAY, max(0.3, (AIMD_CONGESTION_DELAY + 0.1) * 2.0))
            print(f"[AIMD CONGESTION] Chunk {i+1}/{total} RTT={rtt_ms:.1f}ms (ECN={chunk_res.get('congested', False)}). "
                  f"Multiplicative Decrease -> Throttle delay={AIMD_CONGESTION_DELAY:.2f}s")
        else:
            # Additive Increase: carefully reduce delay to probe for bandwidth
            if AIMD_CONGESTION_DELAY > 0:
                AIMD_CONGESTION_DELAY = max(AIMD_MIN_DELAY, AIMD_CONGESTION_DELAY - 0.05)
                print(f"[AIMD RECOVERY] Chunk {i+1}/{total} RTT={rtt_ms:.1f}ms. "
                      f"Additive Increase -> Throttle delay={AIMD_CONGESTION_DELAY:.2f}s")

        if AIMD_CONGESTION_DELAY > 0:
            time.sleep(AIMD_CONGESTION_DELAY)
    body = {"size": len(data)}
    if base_version:
        body["base_version"] = base_version
    done = api(server, "POST", "/api/sync/complete", token, body,
               query=f"?path={q(rel)}&upload_id={upload_id}")
    print(f"[agent] synced {rel} -> v{done.get('version')} conflict={done.get('conflict')} "
          f"deduped={done.get('deduped')}")
    return done


def local_ip(server: str) -> str:
    """The address this machine uses to reach the server (no packets sent)."""
    host = urllib.parse.urlparse(server).hostname or "8.8.8.8"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((host, 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def broadcast_hello():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            s.sendto(json.dumps({"msg": "CAMPUS_NEXUS_HELLO", "host": socket.gethostname()}).encode(),
                     ("<broadcast>", HELLO_PORT))
    except OSError as e:
        print("[agent] broadcast failed:", e)


def listen_hello():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", HELLO_PORT))
    except OSError:
        return  # the server on this machine already listens; fine
    s.settimeout(3.0)
    while True:
        try:
            data, addr = s.recvfrom(1024)
            if json.loads(data.decode()).get("msg") == "CAMPUS_NEXUS_HELLO":
                print(f"[agent] peer hello from {addr[0]}")
        except (socket.timeout, ValueError, OSError):
            continue


def load_state(folder: Path) -> dict:
    try:
        return json.loads((folder / STATE_FILE).read_text())
    except (OSError, ValueError):
        return {}


def save_state(folder: Path, state: dict):
    tmp = folder / (STATE_FILE + ".tmp")
    tmp.write_text(json.dumps(state))
    os.replace(tmp, folder / STATE_FILE)


def main():
    ap = argparse.ArgumentParser(description="Campus Nexus folder sync agent")
    ap.add_argument("--folder", required=True, help="local folder to sync")
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--username", required=True)
    ap.add_argument("--password", default=os.environ.get("NEXUS_PASSWORD"),
                    help="defaults to $NEXUS_PASSWORD, else prompts")
    ap.add_argument("--interval", type=float, default=2.0)
    args = ap.parse_args()
    password = args.password or getpass.getpass(f"Password for {args.username}: ")

    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    print(f"[agent] watching {folder.resolve()} -> {args.server}")
    threading.Thread(target=listen_hello, daemon=True).start()

    token = None
    state = load_state(folder)            # rel -> {"version": n, "sha": ...}
    seen: dict[str, tuple[float, int]] = {}
    last_hb = 0.0
    ip = local_ip(args.server)
    while True:
        try:
            if token is None:
                token = login(args.server, args.username, password)
                print("[agent] logged in as", args.username)
            if time.time() - last_hb > 15:
                broadcast_hello()
                t0 = time.time()
                api(args.server, "POST", "/api/peers/heartbeat", token,
                    {"hostname": socket.gethostname(), "ip": ip, "latency_ms": 0.0})
                last_hb = time.time()
                print(f"[agent] heartbeat ok ({(last_hb - t0) * 1000:.0f} ms)")
            for p in folder.rglob("*"):
                if not p.is_file() or p.name.startswith(STATE_FILE):
                    continue
                rel = p.relative_to(folder).as_posix()     # always '/' for the server
                st = p.stat()
                key = (st.st_mtime, st.st_size)
                if seen.get(rel) == key:
                    continue
                if st.st_size == 0:
                    seen[rel] = key
                    continue
                digest = sha(p.read_bytes())
                if state.get(rel, {}).get("sha") == digest:
                    seen[rel] = key
                    continue
                done = upload_file(args.server, token, folder, rel, state.get(rel, {}).get("version"))
                state[rel] = {"version": done.get("version"), "sha": digest}
                save_state(folder, state)
                seen[rel] = key                     # only after a successful upload
        except AuthError:
            print("[agent] session expired; logging in again")
            token = None
        except urllib.error.URLError as e:
            print(f"[agent] server unreachable ({e.reason}); retrying")
        except Exception as e:
            msg = str(e)
            if "423" in msg:
                print("[agent] sync paused by the server (anomaly review); waiting")
            else:
                print("[agent] error:", msg)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
