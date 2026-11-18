"""Tests for the ML components: anomaly detector and alert ranker."""
import random
import uuid
from datetime import timedelta

from app.core.timeutil import utcnow
from app.ml import anomaly, ranker


# ----------------------------------------------------------------------------- anomaly
def _feed_normal(n=80, seed=1):
    rnd = random.Random(seed)
    for _ in range(n):
        m, c, d = rnd.randint(5, 40), rnd.randint(0, 10), rnd.randint(0, 3)
        anomaly.record_window(m, d, c, rnd.uniform(1, 30), persist=False)


def test_anomaly_hard_rule_fires_without_history():
    anomaly.reset()
    flagged, score = anomaly.is_anomalous(600, 0, 0, 1.0)
    assert flagged is True and score == -1.0
    assert anomaly.is_anomalous(0, 150, 0, 1.0)[0] is True


def test_small_buckets_are_never_ml_anomalies():
    """A single (even huge) upload is not a burst — no false pause."""
    anomaly.reset()
    _feed_normal()
    anomaly.fit_now()
    assert anomaly.is_anomalous(1, 0, 0, 4000.0) == (False, 0.0)
    assert anomaly.is_anomalous(0, 0, 1, 0.001) == (False, 0.0)


def test_isolation_forest_flags_burst_not_normal():
    anomaly.reset()
    _feed_normal()
    anomaly.fit_now()
    normal, _ = anomaly.is_anomalous(20, 1, 5, 12.0)
    burst, score = anomaly.is_anomalous(400, 90, 0, 900.0)    # under the hard rule, far off-distribution
    assert normal is False
    assert burst is True and score < anomaly.SCORE_THRESHOLD
    assert anomaly.is_anomalous(60, 40, 0, 10.0)[0] is True   # delete-heavy burst


def test_false_positive_rate_on_normal_buckets_is_low():
    anomaly.reset()
    _feed_normal(200, seed=2)
    anomaly.fit_now()
    rnd = random.Random(3)
    flagged = sum(anomaly.is_anomalous(rnd.randint(5, 40), rnd.randint(0, 3), rnd.randint(0, 10),
                                       rnd.uniform(1, 30))[0] for _ in range(1000))
    assert flagged / 1000 < 0.01


def test_observe_buckets_events_and_detects_burst_over_time():
    anomaly.reset()
    t0 = 1_000_000.0
    hit = False
    for i in range(anomaly.RULE_TOTAL + 5):           # all within one window
        anomalous, _, counts = anomaly.observe("modified", 0.01, now=t0 + i * 0.01)
        hit = hit or anomalous
    assert hit and counts["modified"] > anomaly.RULE_TOTAL
    # the flagged bucket is not used for training when it closes
    anomaly.observe("modified", 0.01, now=t0 + anomaly.WINDOW_SECONDS + 1)
    assert anomaly.status()["windows_tracked"] == 0
    # a normal bucket is recorded when it closes
    anomaly.observe("created", 0.5, now=t0 + 3 * anomaly.WINDOW_SECONDS)
    assert anomaly.status()["windows_tracked"] == 1


def test_anomaly_transition_reported_once():
    anomaly.reset()
    first, _, _ = anomaly.observe("deleted", 0, now=5.0, count=150)
    again, _, _ = anomaly.observe("deleted", 0, now=5.1, count=1)
    assert first is True and again is False


def test_refit_happens_off_request_path():
    anomaly.reset()
    _feed_normal(anomaly.MIN_SAMPLES + 5)
    anomaly.fit_now()
    first = anomaly._model
    assert first is not None
    anomaly.fit_now()
    assert anomaly._model is not first


# ----------------------------------------------------------------------------- ranker
def _seed(db, user, sender, ack_prios, ignore_prios, days_ago=5):
    from app.db.models.models import Alert, AlertReceipt
    base = utcnow() - timedelta(days=days_ago)
    i = 0
    for kind, prios in (("ack", ack_prios), ("ignore", ignore_prios)):
        for p in prios:
            created = base + timedelta(minutes=i)
            i += 1
            a = Alert(title=f"{kind}-{p}", body="b", priority=p, sender=sender, created_at=created)
            db.add(a)
            db.flush()
            db.add(AlertReceipt(alert_id=a.id, user=user, delivered_at=created,
                                acked_at=(created + timedelta(minutes=5)) if kind == "ack" else None))
    db.commit()


def test_ranker_falls_back_to_heuristic_on_cold_start():
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    ranker.clear_cache()
    with SessionLocal() as db:
        user = f"cold_{uuid.uuid4().hex[:6]}"
        a = Alert(title="x", body="b", priority="CRITICAL", sender="s", created_at=utcnow())
        db.add(a)
        db.commit()
        out = ranker.rank_alerts(db, user, [a])
        assert out[0]["method"] == "heuristic" and 0 <= out[0]["score"] <= 100


def test_ranker_learns_priority_preference():
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    ranker.clear_cache()
    with SessionLocal() as db:
        user = f"warm_{uuid.uuid4().hex[:6]}"
        _seed(db, user, "boss", ["CRITICAL", "URGENT"] * 8, ["INFO", "NORMAL"] * 8)
        now = utcnow()
        hi = Alert(title="hi", body="b", priority="CRITICAL", sender="boss", created_at=now)
        lo = Alert(title="lo", body="b", priority="INFO", sender="boss", created_at=now)
        db.add_all([hi, lo])
        db.commit()
        out = ranker.rank_alerts(db, user, [lo, hi])
        assert all(o["method"] == "learned" for o in out)
        assert out[0]["title"] == "hi" and out[0]["score"] > out[1]["score"]
        assert 0 <= out[1]["score"] <= out[0]["score"] <= 100


def test_ranker_prefers_newer_alerts_at_equal_relevance():
    """Regression: the old model learned 'newer = less likely acked'."""
    from app.db.session import SessionLocal
    from app.db.models.models import Alert
    ranker.clear_cache()
    with SessionLocal() as db:
        user = f"rec_{uuid.uuid4().hex[:6]}"
        _seed(db, user, "boss", ["CRITICAL", "URGENT"] * 8, ["INFO", "NORMAL"] * 8)
        now = utcnow()
        old = Alert(title="old", body="b", priority="URGENT", sender="boss", created_at=now - timedelta(days=3))
        new = Alert(title="new", body="b", priority="URGENT", sender="boss", created_at=now)
        db.add_all([old, new])
        db.commit()
        out = ranker.rank_alerts(db, user, [old, new])
        assert [o["title"] for o in out] == ["new", "old"]


def test_unseen_recent_alerts_are_not_negative_labels():
    from app.db.session import SessionLocal
    ranker.clear_cache()
    with SessionLocal() as db:
        user = f"lbl_{uuid.uuid4().hex[:6]}"
        _seed(db, user, "boss", ["CRITICAL"] * 12, [], days_ago=5)
        _seed(db, user, "boss", [], ["CRITICAL"] * 12, days_ago=0)   # just delivered, not seen yet
        X, y = ranker._training_data(ranker._History(db, user), utcnow())
        assert X is None            # only one real class -> heuristic, not "user ignores CRITICAL"


def test_sender_rate_has_no_label_leakage():
    from app.db.session import SessionLocal
    from app.db.models.models import Alert, AlertReceipt
    with SessionLocal() as db:
        user = f"leak_{uuid.uuid4().hex[:6]}"
        created = utcnow() - timedelta(days=3)
        a = Alert(title="only", body="b", priority="NORMAL", sender="s1", created_at=created)
        db.add(a)
        db.flush()
        db.add(AlertReceipt(alert_id=a.id, user=user, delivered_at=created,
                            acked_at=created + timedelta(minutes=1)))
        db.commit()
        hist = ranker._History(db, user)
        # at the alert's own creation time the user has no history with s1 yet
        assert hist.sender_rate("s1", created) == 0.5
        assert hist.sender_rate("s1", utcnow()) == 2 / 3


def test_acked_alerts_sink_to_bottom():
    from app.db.session import SessionLocal
    from app.db.models.models import Alert, AlertReceipt
    ranker.clear_cache()
    with SessionLocal() as db:
        user = f"ack_{uuid.uuid4().hex[:6]}"
        now = utcnow()
        done = Alert(title="done", body="b", priority="CRITICAL", sender="s", created_at=now)
        todo = Alert(title="todo", body="b", priority="INFO", sender="s", created_at=now)
        db.add_all([done, todo])
        db.flush()
        db.add(AlertReceipt(alert_id=done.id, user=user, delivered_at=now, acked_at=now))
        db.commit()
        out = ranker.rank_alerts(db, user, [done, todo])
        assert [o["title"] for o in out] == ["todo", "done"] and out[1]["acked_by_me"] is True
