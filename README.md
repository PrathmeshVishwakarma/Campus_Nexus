# Campus Nexus — Intelligent Distributed Campus Networking Platform

> An event-driven campus network that turns files, messages, alerts, and network activity into synchronized events — offline-first collaboration without the cloud.

Vision: [`project_overview.md`](project_overview.md) · Build plan: [`project_plan.md`](project_plan.md)

```text
React dashboard (Dashboard · Files · Chat · Alerts · Network)
        │  REST + one authenticated WebSocket (/api/*, /ws/events?token=…)
FastAPI backend — Auth · Events · Sync · Messages · Alerts · ML
        │  unified event bus (every action emits an Event, delivered only to users allowed to see it)
Node agents — folder poll · chunked sync with conflict detection · UDP discovery · heartbeat
```

## What works

| Area | Features |
|------|----------|
| Dashboard | Live event timeline (only events you may see) with search, stat tiles, quick links |
| Files | One shared root with per-subfolder member ACLs (members can be view-only), live tree updates, 1 MB chunked upload with SHA-256 chunk dedup, atomic commit, full version history with **restorable content**, conflict detection from the version an edit was based on, per-file discussion tab in the file panel |
| Chat | Groups + 1:1 DMs (one per pair), members-only access, instant (optimistic) send, per-user read receipts and unread counts, typing indicator, leave group |
| Alerts | 5 priorities (CRITICAL/URGENT need faculty, staff or admin), target everyone / roles / named people, live list + ACK receipts, learned ranking, **Web Push** to devices with the site closed |
| Notifications | Per-user preferences (categories, minimum alert priority, muted chats/folders, do-not-disturb with a summary afterwards, sound/toast/badges) applied to live events, push, nav badges and Smart rank |
| Network | Peer topology graph, scheduler queue viewer, bandwidth/congestion state, anomaly status |
| ML safety | Time-bucketed burst detection (hard rule + IsolationForest with a magnitude gate) → auto-pause sync + banner; an admin reviews and resumes |
| Agent | Stdlib-only poller: heartbeat, change detect, chunked upload, remembers base versions for conflict detection |

## Roles

The **first account registered on an empty database becomes `admin`**; everyone else registers as `student`.
Admins can change roles (`PATCH /api/auth/users/{username}/role`, roles: student · faculty · staff · admin)
or list usernames in `ADMIN_USERNAMES` (they are promoted on startup). Admins move the root, manage
folder ACLs, resume sync after an anomaly, and run anomaly drills.

## Quick start (local, SQLite)

```bash
# backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# API docs: http://localhost:8000/docs
# The schema is migrated to the latest Alembic revision on startup.

# frontend (new terminal)
cd frontend
npm ci && npm run dev
# app: http://localhost:5173 (proxies /api + /ws to the backend)

# node agent (new terminal, stdlib only — no venv needed)
python agent/agent.py --folder ~/nexus-copy --server http://localhost:8000 --username <user>
# password from --password, $NEXUS_PASSWORD, or a prompt
```

Settings live in `backend/.env` (see [`backend/.env.example`](backend/.env.example)). With no
`SECRET_KEY`, one is generated once and kept in `backend/data/secret_key`.

## Two users, one backend

1. Start the backend with `--host 0.0.0.0` (or `docker compose up --build`).
2. Both users open the same frontend URL (`http://<server-ip>:5173` on LAN).
3. Each registers + logs in, then Chat → New → Group or 1:1 DM → send. Messages, typing and read
   receipts arrive live over the WebSocket.

Web Push and system notifications need HTTPS (or `localhost`); the VAPID key pair is generated on
first use in `backend/data/vapid_private.pem`. On plain-`http` LAN addresses browsers also disable `crypto.subtle`, so uploads skip chunk dedup there
(they still work). Use `localhost` or HTTPS to get dedup.

## Docker (Postgres + backend + frontend)

```bash
cp .env.example .env    # set SECRET_KEY (and optionally ADMIN_USERNAMES)
docker compose up --build
# frontend http://localhost:5173 → proxied /api + /ws to the backend
```

The backend runs a single worker on purpose: the anomaly detector and live sockets keep
per-process state.

## API cheat sheet

`GET /health` · `POST /api/auth/register|login` · `GET /api/auth/me|users` · `PATCH /api/auth/users/{u}/role` (admin)
`GET|POST /api/events`
`GET /api/files/tree` · `GET /api/files` · `GET|POST /api/files/root` (admin) · `GET|POST /api/files/folders` · `DELETE /api/files/item`
`GET /api/files/versions?path=` · `GET /api/files/download?path=[&version=]` · `POST /api/files/resolve?path=&strategy=latest|keep-mine|version[&version=]`
`GET /api/sync/manifest` · `POST /api/sync/chunk?path=&index=&total=&upload_id=` · `POST /api/sync/complete?path=&upload_id=` body `{size, base_version}`
`GET|POST /api/messages/channels` · `GET|POST /api/messages` · `POST /api/messages/read?channel_id=` · `POST /api/messages/typing`
`GET|POST /api/alerts` · `GET /api/alerts/ranked` · `POST /api/alerts/{id}/ack` · `GET /api/alerts/{id}/receipts`
`GET|PATCH /api/notifications/settings` · `GET /api/notifications/badges|dnd` · `GET /api/alerts/unacked/count`
`GET /api/push/public-key` · `POST|DELETE /api/push/subscribe`
`GET /api/peers` · `POST /api/peers/heartbeat|discover` · `GET /api/network/graph|stats` · `GET /api/ml/anomalies`
`POST /api/sync/report-activity` (admin drill) · `POST /api/sync/resume-scheduler` (admin) · `WS /ws/events?token=<jwt>`

## Tests

```bash
cd backend && python -m pytest tests/ -q     # runs against a throwaway DB + folders
cd ../frontend && npm run typecheck
```

## 5-minute demo script

1. Register the first account (admin) and a second one → Dashboard (live stats + search).
2. Files → upload → versions + SHA → upload again from an older base → conflict → restore a version.
3. Chat → New group/DM → send → unread badge + "Read by …" receipts; Files → a file → Discussion tab.
4. Alerts → CRITICAL alert (admin) to everyone or a role → ACK → receipts + latency → Smart rank.
5. As admin: `POST /api/sync/report-activity?n_modified=5000` → anomaly banner → Review & Resume.
6. Network → topology + scheduler heap + congestion state.

## Known limits / stretch

- Fixed 1 MB (not content-defined) chunks · conflicts keep both versions and let you pick one
  (no line-level merge) · no E2E encryption · no gossip-mode failover · no mobile client ·
  `email_digest` is stored but no mail is sent.
