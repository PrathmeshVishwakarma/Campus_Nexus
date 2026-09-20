"""Notification ranking.

Two modes
---------
1. **Learned** (default once enough history exists): a logistic regression is
   trained on this user's past alert receipts. Label = did the user acknowledge
   the alert. Features = priority weight, sender affinity, alert age. The
   predicted acknowledgement probability is the rank score.
2. **Heuristic fallback**: the original hand-weighted formula, used when the
   user has too little history (cold start) or only one outcome class.

Every returned item carries ``"method"`` so the UI/tests can tell which mode ran.
"""

import logging
from datetime import datetime

import numpy as np

log = logging.getLogger("campus_nexus.ml.ranker")

PRIORITY_W = {"CRITICAL": 100, "URGENT": 80, "IMPORTANT": 60, "NORMAL": 40, "INFO": 10}
MIN_TRAIN_ROWS = 8          # receipts needed before we trust a learned model


# --------------------------------------------------------------------------- heuristic
def rank_score(priority: str, sender_affinity: float = 0.5, recency_h: float = 1.0) -> float:
    """Original hand-weighted formula (kept as the cold-start fallback)."""
    base = PRIORITY_W.get(priority.upper(), 40)
    return base * 0.6 + sender_affinity * 30 + max(0, 10 - recency_h)


def _features(priority: str, affinity: float, age_h: float) -> list[float]:
    return [PRIORITY_W.get(priority.upper(), 40) / 100.0,
            affinity,
            1.0 / (1.0 + max(0.0, age_h))]     # newer alert -> closer to 1


# --------------------------------------------------------------------------- affinity
def affinity_for(db, username: str, sender: str, _cache: dict | None = None) -> float:
    """Affinity 0..1 from past interaction: acked sender's alerts + got their messages."""
    key = (username, sender)
    if _cache is not None and key in _cache:
        return _cache[key]
    from app.db.models.models import Alert, AlertReceipt, Message
    try:
        acked = db.query(AlertReceipt).filter(
            AlertReceipt.user == username, AlertReceipt.acked_at.is_not(None)).join(
            Alert, Alert.id == AlertReceipt.alert_id).filter(Alert.sender == sender).count()
        msgs = db.query(Message).filter(Message.sender == sender).count()
        val = min(1.0, 0.4 + acked * 0.15 + min(msgs, 10) * 0.03)
    except Exception:
        log.exception("affinity_for failed; using neutral 0.5")
        val = 0.5
    if _cache is not None:
        _cache[key] = val
    return val


# --------------------------------------------------------------------------- training
def _training_data(db, username: str):
    """Build (X, y) from this user's alert receipts. Returns (None, None) if unusable."""
    from app.db.models.models import Alert, AlertReceipt
    rows = (db.query(AlertReceipt, Alert)
            .join(Alert, Alert.id == AlertReceipt.alert_id)
            .filter(AlertReceipt.user == username).all())
    if len(rows) < MIN_TRAIN_ROWS:
        return None, None
    X, y = [], []
    cache: dict = {}
    for receipt, alert in rows:
        # age measured at the time the user acted (ack) or delivery, so the
        # feature reflects what the user actually saw, not "now".
        ref = receipt.acked_at or receipt.delivered_at
        age_h = max(0.0, (ref - alert.created_at).total_seconds() / 3600)
        X.append(_features(alert.priority, affinity_for(db, username, alert.sender, cache), age_h))
        y.append(1 if receipt.acked_at else 0)
    y_arr = np.array(y)
    if len(set(y_arr.tolist())) < 2:          # need both acked and un-acked examples
        return None, None
    return np.array(X, dtype=float), y_arr


def _fit(db, username: str):
    X, y = _training_data(db, username)
    if X is None:
        return None
    try:
        from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(class_weight="balanced", max_iter=200)
        model.fit(X, y)
        return model
    except Exception:
        log.exception("ranker training failed; falling back to heuristic")
        return None


# --------------------------------------------------------------------------- public API
def rank_alerts(db, username: str, alerts: list) -> list:
    now = datetime.utcnow()
    model = _fit(db, username)
    method = "learned" if model is not None else "heuristic"
    cache: dict = {}
    feats, rows = [], []
    for a in alerts:
        age_h = max(0.0, (now - a.created_at).total_seconds() / 3600)
        aff = affinity_for(db, username, a.sender, cache)
        rows.append((a, aff, age_h))
        feats.append(_features(a.priority, aff, age_h))

    if model is not None and feats:
        # Scale probability to 0..100 so the scale matches the heuristic mode.
        scores = (model.predict_proba(np.array(feats, dtype=float))[:, 1] * 100).tolist()
    else:
        scores = [rank_score(a.priority, aff, age_h) for a, aff, age_h in rows]

    scored = sorted(zip(scores, (r[0] for r in rows)), key=lambda x: -x[0])
    return [{"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
             "sender": a.sender, "created_at": a.created_at.isoformat(),
             "score": round(float(s), 1), "method": method} for s, a in scored]