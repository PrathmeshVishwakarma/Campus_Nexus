"""Apply per-user notification preferences to live events.

Every WebSocket frame carries ``notify: bool``. The event itself is always
delivered (so timelines stay complete); ``notify`` tells the client whether to
raise a toast/sound for this user. ``sound`` and ``toast`` mirror the user's
delivery preferences.
"""

from datetime import datetime

from sqlalchemy.orm import Session

from app.db.models.models import NotificationPreference, User
from app.schemas import PRIORITY_MAP
from app.services.visibility import FILE_EVENT_TYPES, top_folder

ALERT_TYPES = {"ALERT_CREATED"}
MESSAGE_TYPES = {"MESSAGE_SENT"}


def _minutes(hhmm: str) -> int | None:
    try:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None


def in_dnd(pref: NotificationPreference, now: datetime | None = None) -> bool:
    """True when local server time is inside the user's do-not-disturb window."""
    start, end = _minutes(pref.dnd_start or ""), _minutes(pref.dnd_end or "")
    if start is None or end is None or start == end:
        return False
    now = now or datetime.now()
    cur = now.hour * 60 + now.minute
    if start < end:
        return start <= cur < end
    return cur >= start or cur < end           # window wraps midnight


def should_notify(pref: NotificationPreference | None, etype: str, actor: str, username: str,
                  resource: str, payload: dict, now: datetime | None = None) -> bool:
    if actor == username:
        return False
    if etype not in ALERT_TYPES | MESSAGE_TYPES and etype not in FILE_EVENT_TYPES:
        return False
    if etype in FILE_EVENT_TYPES and etype not in {"FILE_COMMENT", "VERSION_CONFLICT", "ANOMALY_DETECTED"}:
        return False                           # routine sync noise never toasts
    if pref is None:
        return True                            # defaults: everything on
    if not pref.enabled:
        return False
    if etype in ALERT_TYPES:
        if not pref.enable_alerts:
            return False
        prio = (payload or {}).get("priority", "NORMAL")
        if PRIORITY_MAP.get(prio, 40) < PRIORITY_MAP.get(pref.min_alert_priority or "INFO", 10):
            return False
        # CRITICAL alerts break through do-not-disturb
        if prio != "CRITICAL" and in_dnd(pref, now):
            return False
        return True
    if in_dnd(pref, now):
        return False
    if etype in MESSAGE_TYPES:
        if not pref.enable_messages:
            return False
        cid = (payload or {}).get("channel_id")
        if (payload or {}).get("action"):      # channel management, not a chat message
            return False
        return cid not in set(pref.mute_channel_ids or [])
    # file events
    if not pref.enable_file_events:
        return False
    muted = [p.strip("/") for p in (pref.mute_folder_paths or []) if p]
    rel = (resource or "").strip("/")
    return not any(rel == m or rel.startswith(m + "/") or top_folder(rel) == m for m in muted)


def load_prefs(db: Session, usernames: set[str]) -> dict[str, NotificationPreference | None]:
    if not usernames:
        return {}
    rows = (db.query(User.username, NotificationPreference)
            .outerjoin(NotificationPreference, NotificationPreference.user_id == User.id)
            .filter(User.username.in_(usernames)).all())
    return {u: p for u, p in rows}


def delivery_flags(pref: NotificationPreference | None) -> dict:
    if pref is None:
        return {"sound": True, "toast": True}
    return {"sound": bool(pref.sound), "toast": bool(pref.desktop_toast)}
