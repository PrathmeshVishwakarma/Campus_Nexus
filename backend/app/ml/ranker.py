"""Notification ranking — sorts inbox by priority + affinity + recency."""

from datetime import datetime

PRIORITY_W = {"CRITICAL": 100, "URGENT": 80, "IMPORTANT": 60, "NORMAL": 40, "INFO": 10}


def rank_score(priority: str, sender_affinity: float = 0.5, recency_h: float = 1.0) -> float:
    base = PRIORITY_W.get(priority.upper(), 40)
    return base * 0.6 + sender_affinity * 30 + max(0, 10 - recency_h)


def affinity_for(db, username: str, sender: str) -> float:
    """Affinity 0..1 from past interaction: acked sender's alerts + got their messages."""
    from app.db.models.models import Alert, AlertReceipt, Message
    try:
        acked = db.query(AlertReceipt).filter(AlertReceipt.user == username,
                                              AlertReceipt.acked_at.is_not(None)).join(
            Alert, Alert.id == AlertReceipt.alert_id).filter(Alert.sender == sender).count()
        msgs = db.query(Message).filter(Message.sender == sender).count()
        return min(1.0, 0.4 + acked * 0.15 + min(msgs, 10) * 0.03)
    except Exception:
        return 0.5


def rank_alerts(db, username: str, alerts: list) -> list:
    now = datetime.utcnow()
    scored = []
    for a in alerts:
        recency_h = max(0.0, (now - a.created_at).total_seconds() / 3600)
        aff = affinity_for(db, username, a.sender)
        scored.append((rank_score(a.priority, aff, recency_h), a))
    scored.sort(key=lambda x: -x[0])
    return [{"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
             "sender": a.sender, "created_at": a.created_at.isoformat(),
             "score": round(s, 1)} for s, a in scored]
