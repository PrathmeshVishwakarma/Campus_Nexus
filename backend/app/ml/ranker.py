"""Alert ranking: which alerts is this user most likely to act on?

Model
-----
A per-user logistic regression predicts P(user acknowledges alert) from

* ``priority``    — priority weight / 100
* ``sender_rate`` — Laplace-smoothed share of this sender's *earlier* alerts the
                    user acknowledged ((acked + 1) / (seen + 2))
* ``chat``        — how much the sender talks in channels the user belongs to
                    *before* the alert (min(n, 20) / 20)

Leakage / skew fixes
--------------------
* Features for a training row only use history from before that alert was
  created, so the label (did they ack?) never leaks into ``sender_rate``.
* Alert age is *not* a model feature (training rows can't see "age at ranking
  time"); recency is applied after the model, identically in both modes.
* An un-acked alert only counts as "ignored" once it is older than
  ``LABEL_HORIZON_H`` — unseen is not the same as ignored. The user's own
  alerts are excluded.

Output
------
``score = 100 * (0.8 * relevance + 0.2 * recency)`` in both modes, where
relevance is the learned probability or the heuristic
``0.65 * priority + 0.35 * sender_affinity``. Already-acknowledged alerts sink
to the bottom. Models are cached per user until their receipt history changes.
"""

import bisect
import logging
from collections import OrderedDict
from datetime import datetime, timedelta

import numpy as np
from sqlalchemy import func

from app.core.timeutil import utcnow
from app.schemas import PRIORITY_MAP

log = logging.getLogger("campus_nexus.ml.ranker")

MIN_TRAIN_ROWS = 20          # labelled receipts needed before we trust a learned model
LABEL_HORIZON_H = 24         # un-acked alerts younger than this are "not seen yet"
RECENCY_HALF_LIFE_H = 24
_CACHE_MAX = 256
_model_cache: "OrderedDict[tuple, object]" = OrderedDict()


def _prio(p: str | None) -> float:
    return PRIORITY_MAP.get((p or "NORMAL").upper(), 40) / 100.0


def recency(age_h: float) -> float:
    return 1.0 / (1.0 + max(0.0, age_h) / RECENCY_HALF_LIFE_H)


def blend(relevance: float, age_h: float) -> float:
    return 100.0 * (0.8 * relevance + 0.2 * recency(age_h))


def heuristic_relevance(priority: str, sender_rate: float, chat: float) -> float:
    affinity = 0.7 * sender_rate + 0.3 * chat
    return 0.65 * _prio(priority) + 0.35 * affinity


# kept for callers/tests of the old API
def rank_score(priority: str, sender_affinity: float = 0.5, recency_h: float = 1.0) -> float:
    return blend(0.65 * _prio(priority) + 0.35 * sender_affinity, recency_h)


# --------------------------------------------------------------------------- history
class _History:
    """Everything needed to compute point-in-time features for one user, loaded once."""

    def __init__(self, db, username: str):
        from app.db.models.models import Alert, AlertReceipt, Channel, Message
        self.username = username
        rows = (db.query(AlertReceipt, Alert).join(Alert, Alert.id == AlertReceipt.alert_id)
                .filter(AlertReceipt.user == username, Alert.sender != username)
                .order_by(Alert.created_at).all())
        self.rows = rows
        # per sender: sorted (created_at, acked_at|None) for point-in-time lookups
        self.by_sender: dict[str, list[tuple[datetime, datetime | None]]] = {}
        for r, a in rows:
            self.by_sender.setdefault(a.sender, []).append((a.created_at, r.acked_at))
        my_channels = [c.id for c in db.query(Channel).all() if username in (c.members or [])]
        self.chat_times: dict[str, list[datetime]] = {}
        if my_channels:
            for sender, ts in (db.query(Message.sender, Message.created_at)
                               .filter(Message.channel_id.in_(my_channels), Message.sender != username)
                               .order_by(Message.created_at).all()):
                self.chat_times.setdefault(sender, []).append(ts)

    def sender_rate(self, sender: str, before: datetime) -> float:
        """Smoothed ack rate for this sender as it was known at time ``before``:
        an earlier alert counts as acked only if acked before then, and as
        ignored only if it was already older than the label horizon."""
        horizon = before - timedelta(hours=LABEL_HORIZON_H)
        seen = acked = 0
        for created, acked_at in self.by_sender.get(sender, []):
            if created >= before:
                break
            if acked_at is not None and acked_at < before:
                seen += 1
                acked += 1
            elif created <= horizon:
                seen += 1
        return (acked + 1) / (seen + 2)

    def chat(self, sender: str, before: datetime) -> float:
        n = bisect.bisect_left(self.chat_times.get(sender, []), before)
        return min(n, 20) / 20.0

    def feats(self, priority: str, sender: str, at: datetime) -> list[float]:
        return [_prio(priority), self.sender_rate(sender, at), self.chat(sender, at)]


def _training_data(hist: _History, now: datetime):
    horizon = now - timedelta(hours=LABEL_HORIZON_H)
    X, y = [], []
    for receipt, alert in hist.rows:
        acked = receipt.acked_at is not None
        if not acked and alert.created_at > horizon:
            continue                       # not seen yet -> no label
        X.append(hist.feats(alert.priority, alert.sender, alert.created_at))
        y.append(1 if acked else 0)
    if len(y) < MIN_TRAIN_ROWS or len(set(y)) < 2:
        return None, None
    return np.array(X, dtype=float), np.array(y)


def _cache_key(db, username: str) -> tuple:
    from app.db.models.models import AlertReceipt
    n, last_ack, last_deliv = db.query(func.count(AlertReceipt.id), func.max(AlertReceipt.acked_at),
                                       func.max(AlertReceipt.delivered_at)).filter(
        AlertReceipt.user == username).one()
    hour = utcnow().replace(minute=0, second=0, microsecond=0)   # labels age past the horizon
    return (username, n, last_ack, last_deliv, hour)


def _fit(db, username: str, hist: _History, now: datetime):
    key = _cache_key(db, username)
    if key in _model_cache:
        _model_cache.move_to_end(key)
        return _model_cache[key]
    X, y = _training_data(hist, now)
    model = None
    if X is not None:
        try:
            from sklearn.linear_model import LogisticRegression
            model = LogisticRegression(class_weight="balanced", C=1.0, max_iter=500)
            model.fit(X, y)
        except Exception:
            log.exception("ranker training failed; falling back to heuristic")
            model = None
    _model_cache[key] = model
    while len(_model_cache) > _CACHE_MAX:
        _model_cache.popitem(last=False)
    return model


def clear_cache():
    _model_cache.clear()


# --------------------------------------------------------------------------- public API
def rank_alerts(db, username: str, alerts: list) -> list:
    from app.db.models.models import AlertReceipt
    now = utcnow()
    hist = _History(db, username)
    model = _fit(db, username, hist, now)
    method = "learned" if model is not None else "heuristic"
    acked_ids = set()
    if alerts:
        acked_ids = {aid for (aid,) in db.query(AlertReceipt.alert_id).filter(
            AlertReceipt.user == username, AlertReceipt.acked_at.is_not(None),
            AlertReceipt.alert_id.in_([a.id for a in alerts])).all()}

    feats = [hist.feats(a.priority, a.sender, now) for a in alerts]
    if model is not None and feats:
        relevance = model.predict_proba(np.array(feats, dtype=float))[:, 1].tolist()
    else:
        relevance = [heuristic_relevance(a.priority, f[1], f[2]) for a, f in zip(alerts, feats)]

    scored = []
    for a, rel in zip(alerts, relevance):
        age_h = max(0.0, (now - a.created_at).total_seconds() / 3600)
        scored.append((a.id in acked_ids, -blend(float(rel), age_h), a, blend(float(rel), age_h)))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [{"id": a.id, "title": a.title, "body": a.body, "priority": a.priority,
             "sender": a.sender, "created_at": a.created_at.isoformat(),
             "score": round(s, 1), "method": method, "acked_by_me": acked}
            for acked, _, a, s in scored]
