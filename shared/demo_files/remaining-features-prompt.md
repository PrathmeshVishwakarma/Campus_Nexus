# Prompt for Claude/GPT — Campus Nexus Remaining Features

Copy-paste everything below the line into Claude / GPT.

---

You are working on **Campus Nexus** — an event-driven campus collaboration platform.

**Stack (do not change):**
- Backend: Python FastAPI + Uvicorn, SQLAlchemy (SQLite dev), JWT (`python-jose` + `passlib`), native WebSocket at `WS /ws/events?token=JWT`, unified Event bus (`FILE_CREATED/MODIFIED/DELETED/SYNC_COMPLETED, MESSAGE_SENT, ALERT_CREATED/ACKED, PEER_ONLINE/OFFLINE, ANOMALY_DETECTED`)
- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Zustand + TanStack Query, native WebSocket, `react-router-dom`
- Agent: `agent/agent.py` (stdlib-only poller: heartbeat, change-detect, chunked upload)

**Current state (read these first):**
- `README.md` — what works + API cheat sheet
- `backend/app/api/websockets/events_ws.py` — simple `ConnectionManager.broadcast(event, data)`
- `backend/app/api/routes/messages.py, files.py, alerts.py, events.py`
- `frontend/src/pages/Chat.tsx` — Slack-like groups/DMs, file threads via `?file=<path>` query param + `file_link` filter, WS listener for `MESSAGE_SENT` + 4s poll fallback, manual `loadCh()/loadMsg()` on send/switch
- `frontend/src/pages/Files.tsx` — flat grouping by `dirOf(path)`, manual "Share a folder" (name+path text inputs), manual "Destination folder" text input for upload, version list, resolve (latest/keep-mine), per-file comments via channel dropdown + link "Open in Chat" to `/chat?file=...`
- `frontend/src/pages/Alerts.tsx` — raise broadcast (5 priorities: CRITICAL/URGENT/IMPORTANT/NORMAL/INFO), filter + Refresh + Smart rank buttons, ACK + receipts
- `frontend/src/pages/Dashboard.tsx` — ONLY page fully live via WS today. README Known Limits explicitly says: "chat refreshes on navigation (no live WS yet)"
- There are NO notification settings yet — no backend model, no UI.

**Implement ONLY these 3 remaining features. Do not refactor unrelated code, do not change auth, do not break existing REST endpoints. After changes `cd backend && python -m pytest tests/ -q` must pass and `cd frontend && npx tsc --noEmit` must be clean.**

## 1. Make everything LIVE — zero manual refresh

Goal: No Refresh button, no channel-switch-to-see-messages, no polling as primary mechanism.

Requirements:
- Create one shared frontend hook e.g. `useNexusEvents(token)` that opens ONE `ws://<host>/ws/events?token=` socket with auto-reconnect (exponential backoff), exposes last event, connection status.
- Use it in Chat, Files, Alerts, Dashboard:
  - Chat: on `MESSAGE_SENT` -> append/update message in current channel instantly, update channel list + unread badges live, update read receipts live. Optimistic send + reconcile. Remove 4s `setInterval` poll (keep only as offline fallback if WS closed, with visible "Reconnecting..." state). Incoming message for non-active channel -> unread badge + toast, no full reload.
  - Files: on `FILE_* / SYNC_COMPLETED / VERSION_CONFLICT` -> update tree + version drawer live.
  - Alerts: on `ALERT_CREATED / ALERT_ACKED` -> prepend/update + ACK counts + receipts live.
- Backend: ensure `event_service` broadcasts every create/update (message, file version, alert, ack, thread comment) via `broadcast_event`. No new Socket.IO, keep native WS JSON `{event, data}` shape.
- Acceptance: open two browsers/two users, A sends message/uploads/raises alert -> B sees it in <1s with NO click/refresh. Disconnect WS -> UI shows offline banner, reconnects automatically.

## 2. Rebuild Folder Sharing: single shared root + real file tree + per-file menu + dedicated file chat + group subfolders

Current UX is broken: flat `dirOf()` list, free-text path inputs for share/upload. Replace it.

Requirements:

A) **Single shared folder concept:**
   - One configurable root per node/user (e.g. `~/CampusNexusShared`, default `shared/demo_files`). All shares live UNDER this root.
   - Settings UI to view + change location. On change: backend endpoint like `GET/POST /api/files/root` persists new path, deletes/cleans files from previous location (confirm modal: "Delete X files from old location?"), then re-downloads current shared files/manifest to new location. Agent must respect new root.
   - No more arbitrary `share.name + share.path` text fields.

B) **Real hierarchical file tree:**
   - Left pane: nested expand/collapse tree (folders with children, breadcrumbs, search, file counts, icons). Support arbitrary depth: `root / group-subfolder / files`.
   - Center: file list for selected folder, sort by name/modified/size.
   - Upload = drag-drop or picker into CURRENT folder — no manual destination string. Chunked 1MB upload stays as-is (`POST /api/sync/chunk + POST /api/sync/complete`).

C) **Subfolders = Groups with ACL:**
   - Any subfolder can be shared with specific users/groups only (e.g. `root/ml-project/` shared with `alice,bob`). UI to create subfolder, member picker (reuse Chat user picker), per-folder permissions (view/edit). Backend: `SharedFolder` + membership table, enforce in `GET /api/files` / download / upload (403 if not member). Unshared users don't see it.

D) **Per-file option (⋯) menu + audit:**
   - Clicking ⋯ or selecting file opens detail drawer/panel with tabs: Details (size/hash/version/by), Versions (existing), Activity/Audit (`GET /api/events?resource=<path>` timeline), Share/Manage access.
   - List ALL shared files + their audit clearly here.

E) **Dedicated file chat (NOT general chat):**
   - Remove "Open in Chat" redirect to `/chat?file=`. Instead each file has its OWN embedded discussion panel (right drawer tab "Discussion") backed by file-scoped thread (e.g. auto channel `file:<path>` or `file_link` filtered thread but rendered in Files page only).
   - General Chat (`/chat`) stays for groups/DMs only. File chat must not pollute general chat list.
   - File chat is live (uses hook from #1).

Acceptance: change root -> old files deleted, new root populated; create `root/team-A/` shared with 2 users -> 3rd user can't see it; click file -> ⋯ -> audit + discussion in same drawer, no navigation to /chat.

## 3. Clean + simple Notification Settings

Goal: one simple screen, not scattered buttons.

Requirements:
- Backend: per-user prefs model e.g. `NotificationPreference {user_id, enable_messages, enable_file_events, enable_alerts, min_alert_priority, mute_channel_ids[], mute_folder_paths[], dnd_start, dnd_end, sound, desktop_toast, email_digest}` + `GET/PATCH /api/notifications/settings`.
- Frontend: Settings page or bell-dropdown -> Settings:
  - Master toggle + 3 simple toggles: Messages / Files / Alerts
  - Alerts: minimum priority selector (only notify CRITICAL+URGENT etc.)
  - Mute per-channel + mute per-folder (picker, not text input)
  - Quiet hours (DND start/end)
  - Delivery: in-app toast + sound + badge count (checkboxes)
- Apply prefs BOTH to WS toast logic and to Alerts/Message badges. "Smart rank" stays but must respect `min_alert_priority` + mutes. Keep UI minimal: 1 card, plain language, defaults = all on, min=INFO, no DND.
- Acceptance: mute #general -> no toast/badge for it but still listed; set min=URGENT -> NORMAL/INFO produce no toast; DND on -> queue silently.

**How to deliver:**
1. Explore the 4 frontend pages + backend routes first, then implement backend -> hook -> UI in that order.
2. Show unified diffs per file, keep existing API response shapes backward-compatible (only ADD fields/endpoints).
3. End with manual test steps for the 3 acceptances above + `pytest` / `tsc` results.
