"""Standalone Campus Nexus node agent — stdlib only (no FastAPI/watchdog deps).

Watches a folder by polling, heartbeats to the server, and uploads
changed files in 1MB chunks with SHA-256 resume/dedup via /sync/manifest.

Usage:
  python agent.py --folder ../shared/demo_files --server http://localhost:8000 \\
      --username node1 --password pass123
"""

import argparse
import hashlib
import http.client
import json
import mimetypes
import socket
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

CHUNK = 1024 * 1024
HELLO_PORT = 9999


def api(server, method, path, token=None, body=None, query=""):
    url = server.rstrip("/") + path + query
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode() or "{}")
    except Exception as e:
        print(f"[agent] api {method} {path} failed: {e}")
        return {}


def login(server, username, password):
    data = urllib.parse.urlencode({"username": username, "password": password}).encode()
    req = urllib.request.Request(server.rstrip("/") + "/api/auth/login", data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())["access_token"]


def post_multipart(server, path, query, token, field_name, filename, chunk_bytes):
    boundary = "AGENTBOUNDARY1234"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field_name}\"; "
            f"filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + chunk_bytes + f"\r\n--{boundary}--\r\n".encode()
    u = urllib.parse.urlparse(server.rstrip("/") + path + query)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=30)
    headers = {"Content-Type": f"multipart/form-data; boundary={boundary}",
               "Content-Length": str(len(body))}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    conn.request("POST", u.path + ("?" + u.query if u.query else ""), body, headers)
    resp = conn.getresponse()
    data = resp.read().decode()
    conn.close()
    if resp.status >= 400:
        raise RuntimeError(f"chunk upload {resp.status}: {data[:200]}")
    return json.loads(data or "{}")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def upload_file(server, token, folder: Path, rel: str):
    p = folder / rel
    data = p.read_bytes()
    total = max(1, -(-len(data) // CHUNK))
    man = api(server, "GET", "/api/sync/manifest", token, query=f"?path={urllib.parse.quote(rel)}")
    existing = [c["hash"] for c in (man.get("chunks") or [])] if man.get("exists") else []
    for i in range(total):
        piece = data[i * CHUNK:(i + 1) * CHUNK]
        if i < len(existing) and existing[i] == sha(piece):
            print(f"  chunk {i}/{total} skipped (dedup)")
            continue
        post_multipart(server, "/api/sync/chunk",
                       f"?path={urllib.parse.quote(rel)}&index={i}&total={total}",
                       token, "file", Path(rel).name, piece)
        print(f"  chunk {i + 1}/{total} uploaded")
    done = api(server, "POST", "/api/sync/complete", token, {},
               query=f"?path={urllib.parse.quote(rel)}")
    print(f"[agent] synced {rel} -> v{done.get('version')} conflict={done.get('conflict')} deduped={done.get('deduped')}")


def broadcast_hello():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.sendto(json.dumps({"msg": "CAMPUS_NEXUS_HELLO",
                             "host": socket.gethostname()}).encode(), ("<broadcast>", HELLO_PORT))
        s.close()
    except OSError as e:
        print("[agent] broadcast failed:", e)


def listen_hello():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(("", HELLO_PORT))
    except OSError:
        return
    s.settimeout(3.0)
    while True:
        try:
            data, addr = s.recvfrom(1024)
            if json.loads(data.decode()).get("msg") == "CAMPUS_NEXUS_HELLO":
                print(f"[agent] peer hello from {addr[0]}")
        except (socket.timeout, ValueError, OSError):
            continue


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folder", default="../shared/demo_files")
    ap.add_argument("--server", default="http://localhost:8000")
    ap.add_argument("--username", default="node1")
    ap.add_argument("--password", default="pass123")
    args = ap.parse_args()

    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    print(f"[agent] watching {folder.resolve()} -> {args.server}")

    threading.Thread(target=listen_hello, daemon=True).start()

    try:
        token = login(args.server, args.username, args.password)
        print("[agent] logged in as", args.username)
    except Exception as e:
        print(f"[agent] login failed ({e}); will retry on upload")
        token = None

    seen: dict[str, tuple[float, int]] = {}
    last_hb = 0.0
    while True:
        # heartbeat every 15s
        if time.time() - last_hb > 15:
            broadcast_hello()
            if token:
                api(args.server, "POST", "/api/peers/heartbeat", token,
                    {"hostname": socket.gethostname(), "ip": "127.0.0.1", "latency_ms": 1.0})
            last_hb = time.time()
        # poll folder
        for p in folder.rglob("*"):
            if not p.is_file():
                continue
            rel = str(p.relative_to(folder))
            key = (p.stat().st_mtime, p.stat().st_size)
            if seen.get(rel) != key:
                seen[rel] = key
                print(f"[agent] change: {rel}")
                if token and p.stat().st_size > 0:
                    try:
                        upload_file(args.server, token, folder, rel)
                    except Exception as e:
                        print("[agent] upload failed:", e)
                        try:
                            token = login(args.server, args.username, args.password)
                        except Exception:
                            pass
        time.sleep(2)


if __name__ == "__main__":
    main()
