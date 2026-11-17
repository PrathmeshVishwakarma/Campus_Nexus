from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.models.models import PushSubscription
from app.db.session import get_db
from app.schemas import PushSubscriptionIn
from app.services import push_service

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/public-key")
def get_public_key():
    try:
        return {"key": push_service.public_key()}
    except Exception as exc:
        raise HTTPException(500, f"VAPID unavailable: {exc}")


@router.post("/subscribe")
def subscribe(data: PushSubscriptionIn, db: Session = Depends(get_db),
              user=Depends(get_current_user)):
    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == data.endpoint).first()
    if sub is None:
        sub = PushSubscription(endpoint=data.endpoint)
        db.add(sub)
    sub.username = user.username
    sub.p256dh = data.keys.p256dh
    sub.auth = data.keys.auth
    db.commit()
    return {"ok": True}


@router.delete("/subscribe")
def unsubscribe(endpoint: str, db: Session = Depends(get_db),
                user=Depends(get_current_user)):
    (db.query(PushSubscription)
     .filter(PushSubscription.endpoint == endpoint,
             PushSubscription.username == user.username)
     .delete())
    db.commit()
    return {"ok": True}
