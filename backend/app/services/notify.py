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


def decide(pref: NotificationPreference | None, etype: str, actor: str, username: str,
           resource: str, payload: dict, now: datetime | None = None) -> str:
    """'notify' | 'held' (suppressed only by do-not-disturb) | 'skip'."""
    payload = payload or {}
    if actor == username:
        return "skip"
    if etype not in ALERT_TYPES | MESSAGE_TYPES and etype not in FILE_EVENT_TYPES:
        return "skip"
    if etype in FILE_EVENT_TYPES and etype not in {"FILE_COMMENT", "VERSION_CONFLICT", "ANOMALY_DETECTED"}:
        return "skip"                          # routine sync noise never notifies
    if pref is None:
        return "notify"                        # defaults: everything on
    if not pref.enabled:
        return "skip"
    if etype in ALERT_TYPES:
        if not pref.enable_alerts:
            return "skip"
        prio = payload.get("priority", "NORMAL")
        if PRIORITY_MAP.get(prio, 40) < PRIORITY_MAP.get(pref.min_alert_priority or "INFO", 10):
            return "skip"
        # CRITICAL alerts break through do-not-disturb
        if prio != "CRITICAL" and in_dnd(pref, now):
            return "held"
        return "notify"
    if etype in MESSAGE_TYPES:
        if not pref.enable_messages or payload.get("action"):
            return "skip"                      # disabled, or channel management
        if payload.get("channel_id") in set(pref.mute_channel_ids or []):
            return "skip"
    else:
        if not pref.enable_file_events:
            return "skip"
        muted = [p.strip("/") for p in (pref.mute_folder_paths or []) if p]
        rel = (resource or "").strip("/")
        if any(rel == m or rel.startswith(m + "/") or top_folder(rel) == m for m in muted):
            return "skip"
    return "held" if in_dnd(pref, now) else "notify"


def should_notify(pref: NotificationPreference | None, etype: str, actor: str, username: str,
                  resource: str, payload: dict, now: datetime | None = None) -> bool:
    return decide(pref, etype, actor, username, resource, payload, now) == "notify"


def alert_wanted(pref: NotificationPreference | None, priority: str) -> bool:
    """Does this user want to hear about an alert of this priority at all (badges/push)?"""
    if pref is None:
        return True
    if not pref.enabled or not pref.enable_alerts:
        return False
    return PRIORITY_MAP.get(priority, 40) >= PRIORITY_MAP.get(pref.min_alert_priority or "INFO", 10)


def load_prefs(db: Session, usernames: set[str]) -> dict[str, NotificationPreference | None]:
    if not usernames:
        return {}
    rows = (db.query(User.username, NotificationPreference)
            .outerjoin(NotificationPreference, NotificationPreference.user_id == User.id)
            .filter(User.username.in_(usernames)).all())
    return {u: p for u, p in rows}


def delivery_flags(pref: NotificationPreference | None) -> dict:
    if pref is None:
        return {"sound": True, "toast": True, "badges": True}
    return {"sound": bool(pref.sound), "toast": bool(pref.desktop_toast),
            "badges": pref.badges is not False}
