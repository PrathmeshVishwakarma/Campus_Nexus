# Campus Nexus — Intelligent Distributed Campus Networking Platform

> An event-driven campus network that turns files, messages, alerts, and network activity into synchronized events — offline-first collaboration without the cloud.

Vision: [`project_overview.md`](project_overview.md) · Build plan: [`project_plan.md`](project_plan.md)

```text
React dashboard (Dashboard · Files · Chat · Alerts · Network)
        │  REST + WebSocket (/api/*, /ws/events)
FastAPI backend — Auth · Events · Sync · Messages · Alerts · ML
        │  unified event bus (every action emits an Event)
Node agents — folder watch · chunked sync · UDP discovery · heartbeat
```

## What works

| Area | Features |
|------|----------|
| Dashboard | Live event timeline with search, stat tiles, quick links to every workspace |
| Files | Folder tree, share-a-folder, 1 MB chunked upload with SHA-256 dedup, version history, full download, conflict resolve (latest / keep-mine), per-file comment threads + "Open in Chat" deep links |
| Chat | Custom groups + 1:1 DMs with member picker, unread badges, read receipts, file threads (`/chat?file=<path>`) |
| Alerts | Raise broadcasts with 5 priorities (Critical → Info), always-visible list with filter, ACK tracking + per-user delivery receipts, smart ranking |
| Network | Peer topology graph, scheduler queue viewer, bandwidth/congestion state, anomaly status |
| ML safety | `IsolationForest` + mass-modify rule → auto-pause sync + banner + one-click resume |
| Agent | Stdlib-only poller: heartbeat, change detect, chunked upload |

## Quick start (local, SQLite)

```bash
# backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# API docs: http://localhost:8000/docs

# frontend (new terminal)
cd frontend
npm install && npm run dev
# app: http://localhost:5173 (proxied /api + /ws to backend)

# node agent (new terminal, stdlib only — no venv needed)
python agent/agent.py --folder shared/demo_files --server http://localhost:8000 \
  --username <user> --password <pass>
```

Register two users → log in on two browsers → create a group/DM in Chat → upload in Files → raise an alert → watch the timeline.

## Two users, one backend

Chat is client-server: both browsers talk to the **same** FastAPI backend.

1. Start the backend with `--host 0.0.0.0` (or `docker compose up --build`).
2. Both users open the same frontend URL (`http://<server-ip>:5173` on LAN).
3. Each registers + logs in, then Chat → New → Group or 1:1 DM → send.

Note: chat refreshes on channel switch/send (only the Dashboard subscribes to `/ws/events` live), so the other user clicks into the channel to see new messages.

## Docker (Postgres + backend + frontend)

```bash
docker compose up --build
# frontend http://localhost:5173 → proxied /api + /ws to backend
```

## API cheat sheet

`GET /health` · `POST /api/auth/register|login` · `GET /api/auth/users` · `GET /api/events`
`POST /api/files/share` · `GET /api/files` · `GET /api/files/versions?path=` · `GET /api/files/download?path=` · `POST /api/files/resolve`
`GET /api/sync/manifest` · `POST /api/sync/chunk` · `POST /api/sync/complete`
`GET|POST /api/messages/channels` · `GET|POST /api/messages` · `PATCH /api/messages/{id}/read` · `GET /api/messages/unread/count`
`GET|POST /api/alerts` · `GET /api/alerts/ranked` · `POST /api/alerts/{id}/ack` · `GET /api/alerts/{id}/receipts`
`GET /api/peers` · `POST /api/peers/heartbeat|discover` · `GET /api/network/graph|stats` · `GET /api/ml/anomalies`
`POST /api/sync/report-activity` · `POST /api/sync/resume-scheduler` · `WS /ws/events`

## Tests

```bash
cd backend && python -m pytest tests/ -q   # 5 passed
cd ../frontend && npx tsc --noEmit          # clean
```

## 5-minute demo script

1. Login → Dashboard (live stats + global search).
2. Files → share folder → upload → versions + SHA → per-file comment.
3. Chat → New group/DM → send → unread badge + read receipts → file thread via “Open in Chat”.
4. Alerts → CRITICAL broadcast → ACK → receipts + latency → Smart rank.
5. `POST /api/sync/report-activity?n_modified=5000` → anomaly banner → Resume.
6. Network → topology + scheduler heap + congestion state.

## Known limits / stretch

- Fixed 1 MB (not content-defined) chunks · logical (not byte-level) conflict resolve ·
  no E2E encryption · no gossip-mode failover · chat refreshes on navigation (no live WS yet) · no mobile client.
