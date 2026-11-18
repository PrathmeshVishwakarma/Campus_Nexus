"""Per-user notification preferences.

Exposes GET/PATCH /api/notifications/settings. A preference row is created
lazily with sensible defaults (everything on, min priority INFO, no DND) the
first time a user reads or writes their settings. The preferences are applied
to every live event as its per-user ``notify`` flag (services/notify.py).
``email_digest`` is stored for a future mail integration; no mail is sent.
"""

from app.core.timeutil import utcnow

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import NotificationPreference, User
from app.db.session import get_db
from app.schemas import PRIORITY_MAP

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


def _get_or_create(db: Session, user_id: int) -> NotificationPreference:
    pref = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == user_id).first()
    if not pref:
        pref = NotificationPreference(user_id=user_id)
        db.add(pref)
        db.commit()
        db.refresh(pref)
    return pref


def _serialize(p: NotificationPreference) -> dict:
    return {
        "user_id": p.user_id,
        "enabled": p.enabled,
        "enable_messages": p.enable_messages,
        "enable_file_events": p.enable_file_events,
        "enable_alerts": p.enable_alerts,
        "min_alert_priority": p.min_alert_priority,
        "mute_channel_ids": list(p.mute_channel_ids or []),
        "mute_folder_paths": list(p.mute_folder_paths or []),
        "dnd_start": p.dnd_start or "",
        "dnd_end": p.dnd_end or "",
        "sound": p.sound,
        "desktop_toast": p.desktop_toast,
        "email_digest": p.email_digest,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


class NotificationSettingsPatch(BaseModel):
    """All fields optional — only supplied keys are updated (partial PATCH)."""

    enabled: bool | None = None
    enable_messages: bool | None = None
    enable_file_events: bool | None = None
    enable_alerts: bool | None = None
    min_alert_priority: str | None = None
    mute_channel_ids: list[int] | None = None
    mute_folder_paths: list[str] | None = None
    dnd_start: str | None = None
    dnd_end: str | None = None
    sound: bool | None = None
    desktop_toast: bool | None = None
    email_digest: bool | None = None


def _valid_hhmm(v: str) -> bool:
    if v == "":
        return True
    parts = v.split(":")
    if len(parts) != 2:
        return False
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return 0 <= h <= 23 and 0 <= m <= 59


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _serialize(_get_or_create(db, user.id))


@router.patch("/settings")
def update_settings(data: NotificationSettingsPatch, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    pref = _get_or_create(db, user.id)
    payload = data.model_dump(exclude_unset=True)

    if "min_alert_priority" in payload:
        prio = (payload["min_alert_priority"] or "").upper()
        if prio not in PRIORITY_MAP:
            raise HTTPException(400, f"min_alert_priority must be one of {list(PRIORITY_MAP)}")
        payload["min_alert_priority"] = prio

    for field in ("dnd_start", "dnd_end"):
        if field in payload and not _valid_hhmm(payload[field] or ""):
            raise HTTPException(400, f"{field} must be 'HH:MM' or empty")

    if "mute_folder_paths" in payload and payload["mute_folder_paths"] is not None:
        payload["mute_folder_paths"] = sorted({p.replace("\\", "/").strip().strip("/")
                                               for p in payload["mute_folder_paths"] if p and p.strip()})

    for key, value in payload.items():
        setattr(pref, key, value)
    pref.updated_at = utcnow()
    db.commit()
    db.refresh(pref)
    return _serialize(pref)
