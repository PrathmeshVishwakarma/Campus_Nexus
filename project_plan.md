# Campus Nexus — Project Execution Plan, Tech Stack & Implementation Roadmap

> **Stack Focus:** Python (Backend + Intelligence + Networking) + Aesthetic Modern Frontend  
> **Complement to:** `project_overview.md` — this document is the *how we build it* guide.  
> **Team:** 3 Members | **Duration:** 3 Weeks (21 Days) | **Mode:** Local Network + Offline-First

---

## Table of Contents

1. [Vision & MVP Scope](#1-vision--mvp-scope)
2. [Final Tech Stack](#2-final-tech-stack)
3. [System Architecture](#3-system-architecture)
4. [Project Folder Structure](#4-project-folder-structure)
5. [Data Models & Event Schema](#5-data-models--event-schema)
6. [API & WebSocket Design](#6-api--websocket-design)
7. [Phase-wise Implementation Steps](#7-phase-wise-implementation-steps)
8. [Frontend — Aesthetic Design System](#8-frontend--aesthetic-design-system)
9. [Backend — Module-wise Build Guide](#9-backend--module-wise-build-guide)
10. [Intelligence Engine (ML)](#10-intelligence-engine-ml)
11. [DSA & Networking — Where It Actually Lives](#11-dsa--networking--where-it-actually-lives)
12. [Setup & Installation Commands](#12-setup--installation-commands)
13. [Team Division (3 Members)](#13-team-division-3-members)
14. [Testing, Demo & Evaluation Checklist](#14-testing-demo--evaluation-checklist)
15. [Stretch Goals & Future Scope](#15-stretch-goals--future-scope)

---

## 1. Vision & MVP Scope

### What we MUST ship in 3 weeks (non-negotiable)

| # | Module | Deliverable |
|---|--------|-------------|
| 1 | **Event Bus** | Unified event log for all `FILE | MESSAGE | ALERT | SYSTEM | NETWORK` events |
| 2 | **File Sync Engine** | Folder sharing, file watcher, chunked transfer, SHA-256 verify, version history, conflict detection |
| 3 | **Peer Discovery** | UDP broadcast / `zeroconf` auto-discovery on LAN |
| 4 | **Real-time Messaging** | DMs + Group Channels + File-linked threads, delivery/read receipts via WebSockets |
| 5 | **Alert System** | 5-level priority (Critical→Informational), broadcast, ACK tracking, offline queue |
| 6 | **Network-Aware Scheduler** | Priority queue (Alerts 100 → Backup 10) + bandwidth-aware throttling |
| 7 | **Anomaly Detection** | IsolationForest for mass modify/delete → auto-pause sync + critical alert |
| 8 | **Web Dashboard** | Beautiful React dashboard: Files, Chat, Alerts, Activity Timeline, Network Graph |

### Demo Story (Professors will love this)

> Laptop A edits `Thesis.pdf` → Event fires → Chunked sync to Lab PC + Server → Message auto-posted in file thread → Anomaly engine watches rate → Urgent alert broadcast shows live ACKs on dashboard → Event timeline reconstructs entire history.

---

## 2. Final Tech Stack

### 2.1 Backend — Python 100%

| Layer | Technology | Why |
|-------|------------|-----|
| **Framework** | **FastAPI** + **Uvicorn[standard]** + **Pydantic v2** | Fast, async, auto-docs, WebSocket native |
| **Auth** | `python-jose[cryptography]` + `passlib[bcrypt]` + `python-multipart` | JWT + hashed passwords |
| **Database** | **SQLite** (dev) → **PostgreSQL** (prod) + **SQLAlchemy 2.0** + **Alembic** | Single Python ORM, easy migration |
| **Realtime** | **WebSockets** (`fastapi.websockets`) + `python-socketio` optional | Dashboard live updates |
| **File Watcher** | `watchdog` | Cross-platform FS events |
| **Hashing & Chunks** | `hashlib` (SHA-256) + custom fixed/content-defined chunking (1MB blocks) | Integrity + delta sync |
| **Networking** | `zeroconf` + `socket` + `asyncio` + `psutil` | mDNS discovery, latency/bandwidth monitor |
| **Task Queue** | `APScheduler` + `asyncio.Queue` (PriorityQueue) | Network-aware scheduling — no heavy Celery needed for MVP |
| **ML / Intelligence** | `scikit-learn` (IsolationForest), `pandas`, `numpy` | Anomaly detection + ranking |
| **File Transfer** | `aiofiles` + `httpx` | Async chunked upload/download, resume via Range headers |
| **Testing** | `pytest` + `httpx` + `pytest-asyncio` | API + WS tests |
| **Lint/Format** | `ruff` + `black` | Clean Python |

> **Rule:** No Node.js backend. One language for all intelligence, networking, and file logic.

### 2.2 Frontend — Aesthetic, Visual, Fast

| Layer | Technology | Why |
|-------|------------|-----|
| **Core** | **React 18** + **Vite** + **TypeScript** | Fastest DX, beautiful ecosystem |
| **Styling** | **Tailwind CSS** + **shadcn/ui** + **Radix UI** | Glassmorphism, gradients, accessible, gorgeous out-of-box |
| **Animation** | **Framer Motion** | Smooth pageTransitions, event timeline animations |
| **State** | **Zustand** + **TanStack Query (React Query)** | Simple store + server cache |
| **Realtime** | **native WebSocket** + `zustand` | Live events without Socket.IO overhead |
| **Charts/Visuals** | **Recharts** + **visx** / **d3** (network graph) | Activity graphs, network topology |
| **Icons** | **Lucide React** | Clean, consistent |
| **Forms** | `react-hook-form` + `zod` | Validation mirrors Pydantic |
| **File UI** | `react-dropzone` + custom chunk uploader | Drag-drop sync folders |
| **Alternative if wanted** | **Next.js 14 (App Router)** | Use if you want SSR + file-based routing — same Tailwind/shadcn stack works |

**Design Mood:** Notion + Linear + Slack — *dark/light toggle, glass cards, soft gradients, rounded-2xl, subtle motion.*

### 2.3 Infra & Tooling

| Tool | Purpose |
|------|---------|
| **Git + GitHub** | Versioning |
| **Docker + docker-compose** | `backend + postgres + frontend` one-command up |
| **Nginx (optional)** | Reverse proxy for prod |
| **Pre-commit** | ruff + black hooks |

---

## 3. System Architecture

```text
                    ┌─────────────────────────────────┐
                    │   FRONTEND (React + Vite)       │
                    │  Dashboard │ Files │ Chat │ Alerts│
                    │  Timeline │ Network Graph │ Admin │
                    └──────────────┬──────────────────┘
                                   │ REST + WebSocket (JSON)
                    ┌──────────────▼──────────────────┐
                    │   FASTAPI BACKEND (Python)      │
                    │  ┌───────────────────────────┐  │
                    │  │ Auth (JWT)                │  │
                    │  │ Event Manager (central)   │  │
                    │  │ Message Service           │  │
                    │  │ Alert Service             │  │
                    │  │ Sync Coordinator          │  │
                    │  │ Intelligence Engine (ML)  │  │
                    │  │ Network Monitor           │  │
                    │  └─────────────┬─────────────┘  │
                    └────────────────┼────────────────┘
                                     │ Distributed Event Bus (DB + WebSocket broadcast)
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              ┌──────────┐     ┌──────────┐     ┌──────────┐
              │  Node A  │     │  Node B  │     │  Node C  │
              │  Python  │     │  Python  │     │  Python  │
              │  Agent   │     │  Agent   │     │  Agent   │
              │──────────│     │──────────│     │──────────│
              │ watchdog │     │ watchdog │     │ watchdog │
              │ Sync Eng │     │ Sync Eng │     │ Sync Eng │
              │zeroconf  │     │zeroconf  │     │zeroconf  │
              └──────────┘     └──────────┘     └──────────┘
```

**Protocols:**
* `UDP Multicast (5353 / 9999)` → Peer discovery
* `TCP / HTTP` → Chunked file transfer (`/api/sync/chunks`)
* `WebSocket /ws/events` → Real-time dashboard + chat
* `REST /api/*` → CRUD for files, messages, alerts, events

---

## 4. Project Folder Structure

```text
CNT_CP/
├── project_overview.md
├── project_plan.md              ← YOU ARE HERE
├── docker-compose.yml
├── README.md
│
├── backend/                     # Python FastAPI
│   ├── app/
│   │   ├── main.py              # FastAPI entry
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   ├── security.py      # JWT, hashing
│   │   │   └── network.py       # latency/bandwidth via psutil
│   │   ├── db/
│   │   │   ├── base.py
│   │   │   ├── session.py
│   │   │   └── models/          # SQLAlchemy models
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── auth.py
│   │   │   │   ├── files.py
│   │   │   │   ├── sync.py
│   │   │   │   ├── messages.py
│   │   │   │   ├── alerts.py
│   │   │   │   ├── events.py
│   │   │   │   └── peers.py
│   │   │   └── websockets/
│   │   │       └── events_ws.py
│   │   ├── services/
│   │   │   ├── event_service.py
│   │   │   ├── file_watcher.py  # watchdog wrapper
│   │   │   ├── sync_engine.py   # chunk, hash, transfer
│   │   │   ├── peer_discovery.py# zeroconf
│   │   │   ├── message_service.py
│   │   │   ├── alert_service.py
│   │   │   └── scheduler.py     # PriorityQueue
│   │   ├── ml/
│   │   │   ├── anomaly.py       # IsolationForest
│   │   │   ├── ranker.py        # notification ranking (optional)
│   │   │   └── features.py
│   │   └── schemas/             # Pydantic schemas
│   ├── alembic/
│   ├── requirements.txt
│   └── tests/
│
├── agent/                       # Lightweight Node Agent (Python)
│   ├── agent.py
│   ├── watcher.py
│   ├── sync_client.py
│   └── discovery.py
│
├── frontend/                    # React + Vite + Tailwind + shadcn
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Files.tsx
│   │   │   ├── Chat.tsx
│   │   │   ├── Alerts.tsx
│   │   │   ├── Timeline.tsx
│   │   │   └── Network.tsx
│   │   ├── components/
│   │   │   ├── ui/              # shadcn components
│   │   │   ├── FileCard.tsx
│   │   │   ├── EventTimeline.tsx
│   │   │   ├── NetworkGraph.tsx
│   │   │   └── PriorityBadge.tsx
│   │   ├── hooks/
│   │   ├── store/               # zustand
│   │   ├── lib/
│   │   └── App.tsx
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── package.json
│
└── shared/                      # synced folders for demo
    └── demo_files/
```

---

## 5. Data Models & Event Schema

### 5.1 Core Tables (SQLAlchemy)

```python
# User
id, username, email, hashed_password, role (student/faculty/admin), created_at

# SharedFolder
id, name, path, owner_id, created_at

# FileVersion
id, file_path, version, hash_sha256, chunks JSON, size, modified_by, timestamp

# Event  ← HEART OF SYSTEM
id, type ENUM(FILE_CREATED,MODIFIED,DELETED,SYNC_STARTED,SYNC_COMPLETED,
              MESSAGE_SENT, ALERT_CREATED, ALERT_ACKED, PEER_ONLINE, PEER_OFFLINE, ANOMALY_DETECTED),
     payload JSON, priority INT, actor_id, resource_path, timestamp, vector_clock JSON

# Message
id, channel_id, sender_id, content, file_link, created_at, delivered BOOLEAN, read BOOLEAN

# Channel (DM / Group / Department / File-thread)
id, name, type, members JSON, created_at

# Alert
id, title, body, priority ENUM(CRITICAL,URGENT,IMPORTANT,NORMAL,INFO),
   sender_id, target_scope, created_at, expires_at

# AlertReceipt
alert_id, user_id, delivered_at, acked_at, latency_ms

# Peer
id, hostname, ip, last_seen, status, latency_ms, bandwidth_kbps

# SyncTask
id, file_path, priority, status(queued,syncing,done,failed), retries, created_at
```

### 5.2 Unified Event JSON Example

```json
{
  "id": "evt_91f3",
  "type": "FILE_MODIFIED",
  "actor": "prathmesh",
  "resource": "/shared/Thesis/Thesis.pdf",
  "timestamp": "2026-09-05T10:41:00Z",
  "priority": 60,
  "payload": {
    "old_hash": "a1b2…",
    "new_hash": "c3d4…",
    "chunks_changed": [4, 7],
    "size": 2147483648
  },
  "vector_clock": {"nodeA": 5, "nodeB": 3}
}
```

---

## 6. API & WebSocket Design

### 6.1 REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/auth/register` | Register |
| `POST` | `/api/auth/login` | JWT login |
| `GET` | `/api/events?resource=&type=&limit=` | Timeline / audit trail |
| `GET` | `/api/files` | List shared folders/files |
| `POST` | `/api/files/share` | Share folder |
| `GET` | `/api/files/versions?path=` | Version history |
| `POST` | `/api/sync/chunk` | Upload chunk (with SHA) |
| `GET` | `/api/sync/chunk?id=&index=` | Download chunk |
| `POST` | `/api/sync/resume` | Resume interrupted |
| `GET/POST` | `/api/messages/channels` | List/create channels |
| `GET/POST` | `/api/messages` | List/send messages |
| `POST` | `/api/alerts` | Create alert (priority) |
| `POST` | `/api/alerts/{id}/ack` | Acknowledge |
| `GET` | `/api/alerts/{id}/receipts` | Who acked |
| `GET` | `/api/peers` | Discovered peers + health |
| `GET` | `/api/network/stats` | Latency, bandwidth, loss |
| `GET` | `/api/ml/anomalies` | Recent anomalies |

### 6.2 WebSocket

* **URL:** `ws://localhost:8000/ws/events?token=JWT`
* **Server → Client:**
  ```json
  {"event": "FILE_MODIFIED", "data": {...}}
  {"event": "MESSAGE_SENT", "data": {...}}
  {"event": "ALERT_CREATED", "data": {... priority: 100}}
  {"event": "ANOMALY_DETECTED", "data": {...}}
  ```
* **Client → Server:** `{"action":"ACK_ALERT","alert_id":"..."}`

---

## 7. Phase-wise Implementation Steps

### WEEK 0 — Preparation (Day 0)

- [ ] Finalize this plan + `project_overview.md` review
- [ ] Create GitHub repo + branches (`main`, `dev`, `backend`, `frontend`)
- [ ] Decide: `SQLite` for Week1, migrate to Postgres in Docker later
- [ ] Install Python 3.11+, Node 20+, VS Code extensions
- [ ] Create `backend/requirements.txt` + `frontend` via `npm create vite@latest`

---

### WEEK 1 — Foundation & Event Core (Days 1-7)

**Goal:** Event log flows end-to-end, auth works, dashboard skeleton live.

| Day | Task | Owner | Output |
|-----|------|-------|--------|
| **1** | **Project init** — FastAPI `main.py`, SQLAlchemy base, Alembic, `/health`, CORS, SQLite | Backend #1 | `GET /health` returns 200 |
| **1** | **Frontend init** — Vite+TS+Tailwind+shadcn init, layout shell (Sidebar, Topbar, Dark toggle) | Frontend #3 | Aesthetic shell runs on :5173 |
| **2** | **Auth** — `User` model, `passlib` hash, JWT (`jose`), `/register`, `/login`, `get_current_user` dep | Backend #1 | Login returns JWT, protected routes |
| **2** | **Frontend Auth pages** — Login/Register, `zustand` auth store, `react-hook-form+zod` | Frontend #3 | Users can log in |
| **3** | **Event System DB** — `Event` model + `schemas`, `POST /api/events`, `GET /api/events`, priority field, WebSocket broadcast stub | Backend #1 | Events persist + list |
| **3** | **WebSocket** — `/ws/events`, connection manager, broadcast on new event, frontend `useWebSocket` hook | Full-stack | Dashboard gets live toast on new event |
| **4** | **Dashboard v1** — Timeline page (`EventTimeline.tsx` with Framer Motion), filter by type, Recharts activity graph | Frontend #3 | Beautiful timeline |
| **5** | **SharedFolder + FileVersion models** — `/api/files` CRUD, folder share API | Backend #2 | APIs ready |
| **5** | **Files page UI** — `FileCard`, folder tree, breadcrumb, `react-dropzone` | Frontend #3 | Files UI static |
| **6** | **Peer Discovery v1** — `zeroconf` service `_campus-nexus._tcp.local.` + UDP broadcast fallback, `GET /api/peers` | Backend #2 | Peers show on Network page |
| **7** | **Integration + Demo** — Docker-compose up, seed data, end-to-end auth→event→WS test | ALL | Week 1 Demo OK |

**Week 1 Exit Criteria:** Login → create event → timeline updates live on another browser tab.

---

### WEEK 2 — Sync, Messaging, Alerts (Days 8-14)

**Goal:** Files sync with hashing, chat works, alerts with ACK.

| Day | Task | Details |
|-----|------|---------|
| **8** | **File Watcher** | `watchdog` observer on `shared/` → auto-create `FILE_CREATED/MODIFIED/DELETED` events → push to `PriorityQueue` |
| **8** | **Hashing & Chunking** | `hashlib.sha256`, split 1MB chunks, store chunk hashes, dedup: if hash exists → skip transfer |
| **9** | **Sync Engine** | `SyncCoordinator`: `queue → chunk → POST /api/sync/chunk → verify → SYNC_COMPLETED event` + resume via `Range` + `aiofiles` |
| **10** | **Version & Conflict** | `FileVersion` increment + `vector_clock` per node + detect concurrent edit → `VERSION_CONFLICT` event → LWW fallback + UI badge |
| **11** | **Messaging Backend** | `Channel`, `Message` models, `/api/messages/*`, delivery/read flags, `MESSAGE_SENT` event + WS broadcast |
| **11** | **Chat Frontend** | Slack-like layout: channel list + message pane + file-thread panel, optimistic updates, read receipts |
| **12** | **Alert System Backend** | `Alert` + `AlertReceipt`, 5 priorities, `POST /api/alerts` → broadcast by priority, `POST /ack`, latency tracking, offline peers queued |
| **12** | **Alerts Frontend** | Alert composer (priority selector), inbox with Critical pulse animation, ACK button, receipts table |
| **13** | **Priority Scheduler** | `asyncio.PriorityQueue`: `Critical(100) > Message(80) > Metadata(60) > Sync(40) > Backup(10)` + `psutil` bandwidth check → throttle large sync if congested |
| **14** | **Network Monitor + Graph** | Ping peers, collect latency, `GET /api/network/stats`, frontend `NetworkGraph.tsx` (D3 force graph) showing isolated/central nodes |

**Week 2 Exit Criteria:** Edit file on Node A → Node B gets delta chunks → chat thread updates live → professor sends Critical alert → all nodes ACK, dashboard shows who’s offline.

---

### WEEK 3 — Intelligence, Polish, Deployment (Days 15-21)

| Day | Task | Details |
|-----|------|---------|
| **15** | **Anomaly Detection v1** | Collect features per 5min window: `files_modified, deleted, total_mb, unique_actors` → `IsolationForest` on rolling history → if anomaly → `ANOMALY_DETECTED` event + auto-pause sync |
| **15** | **Frontend Anomaly Card** | Red banner, “Suspended sync, preserved versions”, recovery button |
| **16** | **Notification Ranking (optional)** | Score = `w1*priority + w2*sender_affinity + w3*recency` → sort inbox |
| **16** | **Polish Files** | Version history drawer (Git-style), selective sync toggle, conflict resolver dialog |
| **17** | **Polish Dashboard** | Global search (files+messages+events), dark/light theme, glassmorphism, responsive, loading skeletons |
| **18** | **Agent packaging** | `agent/agent.py` as standalone Python daemon: discovers peers, watches folder, syncs without dashboard |
| **19** | **Testing** | `pytest` for auth/events/sync, manual LAN test with 2 laptops + 1 VM, file integrity check (`sha256sum`) |
| **20** | **Docker & Docs** | `docker-compose.yml` (backend+postgres+frontend nginx), `README` with setup + architecture diagram + screenshots |
| **21** | **Final Demo & PPT** | Record demo flow, prepare slides: Problem → Architecture → Tech Stack → Event Demo → ML Anomaly → DSA Priority Queue → Graph → Conclusion |

**Week 3 Exit Criteria:** Beautiful, production-like demo ready for viva.

---

## 8. Frontend — Aesthetic Design System

### 8.1 Look & Feel

* **Colors:** Slate 950 bg + violet/indigo gradient accents (`from-violet-600 to-indigo-600`), emerald for success, rose for Critical
* **Typography:** `Inter` (UI) + `JetBrains Mono` (hashes/logs)
* **Effects:** `backdrop-blur-xl`, `rounded-2xl`, `shadow-soft`, `border-white/10`, subtle `framer-motion` spring
* **Light/Dark:** `next-themes` style toggle, default dark for campus lab vibe

### 8.2 Pages & Components

| Page | Route | Aesthetic Highlights |
|------|-------|----------------------|
| **Dashboard** | `/` | Stat cards (Peers online, Files synced, Alerts pending, Events today), Recharts area chart (events/hour), live event ticker |
| **Files** | `/files` | Finder-style with folder tree left, FileCards center, Version drawer right, chunk progress bar, SHA badge |
| **Chat** | `/chat` | Slack/Discord: channel sidebar, message bubbles, file-linked thread, typing indicator, delivery ✓✓ |
| **Alerts** | `/alerts` | Priority tabs (Critical pulse), timeline, ACK avatars, latency ms |
| **Timeline** | `/timeline` | GitHub-style vertical timeline, filter chips (FILE/MESSAGE/ALERT), search + date range |
| **Network** | `/network` | D3 force graph of nodes, health bars (latency, bandwidth), isolated node warning |

### 8.3 Shared UI Kit (shadcn)

`Button`, `Card`, `Dialog`, `Dropdown`, `Tabs`, `Badge`, `Toast (sonner)`, `Skeleton`, `Avatar`, `Tooltip` — all customized with Tailwind.

---

## 9. Backend — Module-wise Build Guide

### 9.1 File Watcher (`services/file_watcher.py`)

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
# OnModified -> compute hash -> create Event -> scheduler.put((priority, task))
```

### 9.2 Sync Engine (`services/sync_engine.py`)

```python
def chunk_file(path, chunk_size=1_048_576): # 1MB
    # read, sha256 per chunk, return list[(index, hash, bytes)]

def sync_file(file_path):
    # 1. chunk + dedup (check hash in DB)
    # 2. enqueue chunks to PriorityQueue
    # 3. POST /api/sync/chunk with retry + resume
    # 4. verify final sha256
    # 5. emit SYNC_COMPLETED
```

### 9.3 Scheduler (`services/scheduler.py`)

```python
import asyncio, heapq
# heap = [(100, alert_task), (80, msg), (40, sync)]
# while True:
#   if psutil.net_io_counters().bytes_sent > THRESHOLD: throttle
#   await process(heapq.heappop(heap))
```

### 9.4 Peer Discovery (`services/peer_discovery.py`)

```python
from zeroconf import Zeroconf, ServiceInfo
# register _campus-nexus._tcp.local.
# browse + UDP broadcast on 255.255.255.255:9999
```

---

## 10. Intelligence Engine (ML)

### 10.1 Anomaly Detection — *Primary ML Feature*

**Why it matters:** Ransomware / faulty sync / mass deletion → genuine campus risk.

**Approach:**
1. **Feature window (every 1 min):** `n_modified, n_deleted, n_created, total_bytes, unique_users, entropy_of_paths`
2. **Model:** `IsolationForest(contamination=0.02)` trained on last 7 days of normal windows (10–50 files/hour)
3. **Trigger:** `if anomaly_score < threshold → create ANOMALY_DETECTED (priority 100) → pause scheduler → snapshot versions`
4. **Frontend:** Red banner + “Review & Restore” button

**File:** `backend/app/ml/anomaly.py` — ~80 lines Python, fully explainable in viva.

```python
from sklearn.ensemble import IsolationForest
model = IsolationForest(contamination=0.02)
model.fit(normal_windows)  # pandas DataFrame
score = model.decision_function([current_window])
```

### 10.2 Optional: Notification Ranking & Predictive Sync

* **Ranking:** Logistic regression on `(priority, sender_affinity, open_history)` → sort inbox
* **Predictive:** Co-occurrence of device pairs → pre-warm sync

---

## 11. DSA & Networking — Where It Actually Lives

| Concept | Where Used | Implementation |
|---------|------------|----------------|
| **Priority Queue (Heap)** | Event scheduler | `heapq` / `asyncio.PriorityQueue` — Alerts always first |
| **Hashing (SHA-256)** | Integrity + dedup | `hashlib` per chunk + file |
| **Chunking (Rolling Hash)** | Delta sync | Fixed 1MB or content-defined (optional) |
| **Graph (BFS/DFS)** | Network topology | `networkx` model of peers → find isolated nodes, central node, shortest path |
| **Vector Clocks** | Conflict detection | `dict[node_id → counter]` per file version |
| **Consistent Hashing** | (Stretch) Event shard | `hash(event_id) % N` for distribution |

This is *systems DSA*, not just “we used BFS in a button”.

---

## 12. Setup & Installation Commands

### 12.1 Prerequisites

* Python 3.11+, Node 20+, Git, Docker (optional)

### 12.2 Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install fastapi "uvicorn[standard]" sqlalchemy alembic pydantic python-jose[cryptography] passlib[bcrypt] python-multipart watchdog zeroconf psutil scikit-learn pandas numpy aiofiles httpx pytest pytest-asyncio ruff black

# Run
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# Docs: http://localhost:8000/docs
```

**`requirements.txt` (copy-paste):**

```
fastapi
uvicorn[standard]
sqlalchemy
alembic
pydantic
python-jose[cryptography]
passlib[bcrypt]
python-multipart
watchdog
zeroconf
psutil
scikit-learn
pandas
numpy
aiofiles
httpx
pytest
pytest-asyncio
```

### 12.3 Frontend Setup

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install zustand @tanstack/react-query framer-motion recharts lucide-react react-hook-form zod @hookform/resolvers react-dropzone sonner

# shadcn
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card dialog tabs badge avatar skeleton tooltip dropdown-menu toast

npm run dev # http://localhost:5173
```

**`tailwind.config.js`** — enable `darkMode: "class"`, violet palette.

### 12.4 Docker (One-Command Demo)

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:15
    environment: [POSTGRES_DB=campus_nexus, POSTGRES_USER=nexus, POSTGRES_PASSWORD=nexus]
  backend:
    build: ./backend
    ports: ["8000:8000"]
    depends_on: [db]
  frontend:
    build: ./frontend
    ports: ["5173:80"]
```

```bash
docker-compose up --build
```

### 12.5 Agent (Node)

```bash
cd agent
python agent.py --folder ../shared/demo_files --discovery-port 9999
```

---

## 13. Team Division (3 Members)

| Member | Role | Owns |
|--------|------|------|
| **A — Backend Lead** | Python/FastAPI, DB, Auth, Event Bus, WebSocket, Testing | `backend/app/core`, `db`, `api`, `websockets` |
| **B — Sync & Network** | File watcher, Chunking, Sync engine, Peer discovery, Scheduler, ML anomaly | `services/`, `agent/`, `ml/` |
| **C — Frontend Lead** | React aesthetic, All pages, WebSocket client, Recharts, D3 graph, UX | `frontend/src` |

**Daily sync:** 15 min stand-up: “Events flowing? Chunks verified? UI matches API?”

---

## 14. Testing, Demo & Evaluation Checklist

### Tests

- [ ] `pytest tests/test_events.py` — event creation + priority
- [ ] `pytest tests/test_sync.py` — chunk hash + resume
- [ ] `pytest tests/test_alerts.py` — ACK tracking
- [ ] Manual: 2 laptops on same WiFi → discovery within 3 sec
- [ ] Manual: Edit 1GB file → only changed chunks transfer (check logs)

### Viva Questions Ready

* “Why Priority Queue over FIFO?” → Critical alerts starve?
* “How do you handle simultaneous edits?” → Vector clocks + LWW
* “What if network is 10kbps?” → Scheduler throttles sync, prioritizes alerts
* “Show anomaly detection” → Trigger 5000 modifies in script → banner appears

### Demo Script (5 min)

1. Login → Dashboard (live stats)
2. Create folder share → drop file → watch live sync + timeline
3. Open file thread → chat → delivery ✓✓
4. Send Critical alert → show ACKs + offline handling
5. Run `python simulate_anomaly.py` → anomaly banner → paused sync
6. Show Network graph + priority queue logs

---

## 15. Stretch Goals & Future Scope

* [ ] Vector clocks → full CRDT for offline edits
* [ ] Content-defined chunking (Rabin fingerprint) for better delta
* [ ] E2E encryption for messages/alerts
* [ ] ML notification ranking from real usage logs
* [ ] Fully decentralized operation (no central server, gossip protocol)
* [ ] Mobile app (React Native) as Node Agent

---

## Quick Start Checklist (Copy for GitHub Issues)

- [ ] Week 1: Auth + Event Bus + WebSocket + Timeline
- [ ] Week 2: Watcher + Chunk Sync + Chat + Alerts + Scheduler
- [ ] Week 3: Anomaly ML + Polish + Docker + PPT
- [ ] All: Beautiful, glassy, responsive frontend — not a bootstrap template

> **Principle:** Every feature must emit an Event. If it’s not an Event, it’s not Campus Nexus.

---

**Next step:** Run `backend` and `frontend` init commands above, commit, and start Day 1 tasks. Refer to `project_overview.md:1` for vision; this plan is for execution.
