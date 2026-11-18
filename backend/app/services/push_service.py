"""Web Push (VAPID) support so alerts reach browsers even when the site is closed."""

import base64
import json
from pathlib import Path

from app.core.config import settings

_vapid = None


def _key_file() -> Path:
    # Keep the private key with the other server secrets (data_dir), never in the repo.
    if settings.vapid_private_key_file:
        return Path(settings.vapid_private_key_file)
    return settings.data_path / "vapid_private.pem"


def _load_vapid():
    """Load the VAPID key pair, generating and persisting one on first use."""
    global _vapid
    if _vapid is not None:
        return _vapid
    from py_vapid import Vapid

    path = _key_file()
    if path.exists():
        vapid = Vapid.from_file(str(path))
    else:
        vapid = Vapid()
        vapid.generate_keys()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(vapid.private_pem())
        try:
            path.chmod(0o600)
        except OSError:
            pass
    _vapid = vapid
    return _vapid


def public_key() -> str:
    """VAPID public key as unpadded base64url (what PushManager expects)."""
    from cryptography.hazmat.primitives import serialization

    vapid = _load_vapid()
    raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def send_alert_push(recipients: list[str], payload: dict) -> None:
    """Send a background notification to every subscribed device of `recipients`."""
    if not recipients:
        return
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:  # dependency not installed — skip silently
        return

    from app.db.models.models import PushSubscription
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        subs = (db.query(PushSubscription)
                .filter(PushSubscription.username.in_(recipients)).all())
        if not subs:
            return
        data = json.dumps(payload)
        claims = {"sub": settings.vapid_subject}
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=data,
                    vapid_private_key=_load_vapid(),
                    vapid_claims=dict(claims),
                    ttl=3600,
                )
            except WebPushException as exc:
                # 404/410 means the browser dropped the subscription — prune it.
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    db.delete(sub)
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
            except Exception:
                continue
    finally:
        db.close()
