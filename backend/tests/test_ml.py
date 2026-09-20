"""Tests for the ML components: anomaly detector and learned notification ranker."""
import uuid
from datetime import datetime, timedelta

from app.ml import anomaly, ranker


# ----------------------------------------------------------------------------- anomaly
def _feed_normal(n=60):
    for i in range(n):
        anomaly.record_window(1 + i % 3, 0, i % 2, 0.1 + (i % 5) * 0.05)


def test_anomaly_hard_rule_fires_without_history():
    anomaly.reset()
    flagged, score = anomaly.is_anomalous(600, 0, 0, 1.0)
    assert flagged is True and score == -1.0
    flagged, _ = anomaly.is_anomalous(0, 150, 0, 1.0)      # mass delete
    assert flagged is True


def test_anomaly_needs_history_before_model_runs():
    anomaly.reset()
    anomaly.record_window(1, 0, 0, 0.1)
    assert anomaly.is_anomalous(3, 0, 1, 0.2) == (False, 0.0)
    assert anomaly.status()["model_fitted"] is False


def test_anomaly_isolation_forest_flags_outlier_but_not_normal():
    anomaly.reset()
    _feed_normal()
    normal, _ = anomaly.is_anomalous(2, 0, 1, 0.15)
    outlier, score = anomaly.is_anomalous(400, 90, 50, 900.0)   # under the hard rule, far off-distribution
    assert normal is False
    assert outlier is True and score < 0
    assert anomaly.status()["model_fitted"] is True


def test_anomaly_model_is_cached_and_refit_only_when_stale():
    anomaly.reset()
    _feed_normal()
    anomaly.is_anomalous(2, 0, 1, 0.15)
    first = anomaly._model
    for _ in range(anomaly.REFIT_EVERY - 1):          # not yet stale
        anomaly.record_window(2, 0, 1, 0.15)
    anomaly.is_anomalous(2, 0, 1, 0.15)
    assert anomaly._model is first                    # reused, not refit
    anomaly.record_window(2, 0, 1, 0.15)              # now stale
    anomaly.is_anomalous(2, 0, 1, 0.15)
    assert anomaly._model is not first                # refit happened


# ----------------------------------------------------------------------------- ranker
def _seed_history(db, user, ack_priorities, ignore_priorities):
    from app.db.models.models import Alert, AlertReceipt
    made = []
    base = datetime.utcnow() - timedelta(days=2)
    for kind, prios in (("ack", ack_priorities), ("ignore", ignore_priorities)):
        for p in prios:
            a = Alert(title=f"{kind}-{p}", body="b", priority=p, sender="admin", created_at=base)
            db.add(a); db.flush()
            db.add(AlertReceipt(alert_id=a.id, user=user, delivered_at=base,
                                acked_at=(base + timedelta(minutes=5)) if kind == "ack" else None))
    db.commit()


def test_ranker_falls_back_to_heuristic_on_cold_start():
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    db = SessionLocal()
    try:
        user = f"cold_{uuid.uuid4().hex[:6]}"
        a = Alert(title="x", body="b", priority="CRITICAL", sender="s", created_at=datetime.utcnow())
        db.add(a); db.commit()
        out = ranker.rank_alerts(db, user, [a])
        assert out[0]["method"] == "heuristic"
    finally:
        db.close()


def test_ranker_learns_from_ack_history():
    """User always acks CRITICAL/URGENT and ignores INFO/NORMAL -> learned model should agree."""
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    db = SessionLocal()
    try:
        user = f"warm_{uuid.uuid4().hex[:6]}"
        _seed_history(db, user, ["CRITICAL", "URGENT"] * 4, ["INFO", "NORMAL"] * 4)
        now = datetime.utcnow()
        hi = Alert(title="hi", body="b", priority="CRITICAL", sender="admin", created_at=now)
        lo = Alert(title="lo", body="b", priority="INFO", sender="admin", created_at=now)
        db.add_all([hi, lo]); db.commit()
        out = ranker.rank_alerts(db, user, [lo, hi])          # deliberately mis-ordered input
        assert all(o["method"] == "learned" for o in out)
        assert out[0]["title"] == "hi"                          # learned model ranks the alert user cares about first
        assert out[0]["score"] > out[1]["score"]
        assert 0 <= out[1]["score"] <= out[0]["score"] <= 100
    finally:
        db.close()


def test_ranker_single_class_history_falls_back():
    """If the user has acked everything, there's nothing to learn a contrast from."""
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    db = SessionLocal()
    try:
        user = f"one_{uuid.uuid4().hex[:6]}"
        _seed_history(db, user, ["CRITICAL"] * 10, [])
        a = Alert(title="x", body="b", priority="NORMAL", sender="admin", created_at=datetime.utcnow())
        db.add(a); db.commit()
        assert ranker.rank_alerts(db, user, [a])[0]["method"] == "heuristic"
    finally:
        db.close()