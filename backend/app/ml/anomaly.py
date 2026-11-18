"""Ransomware-style burst detection over time-bucketed file activity.

Design
------
* **Time buckets, not single events.** Every file event (create / modify /
  delete, with its real size) is added to the current ``WINDOW_SECONDS`` bucket.
  A sample is the bucket's totals — so a burst of 500 rewrites in 30 s looks
  like one big sample, which is exactly the pattern we want to catch.
* **Hard rule** on the live bucket: more than ``RULE_TOTAL`` changes or
  ``RULE_DELETES`` deletes in one bucket is always anomalous.
* **IsolationForest** learns what busy-but-normal buckets look like. It only
  judges buckets with at least ``MIN_EVENTS_FOR_ML`` events — a single upload,
  however large, is never a burst — and only flags clearly isolated points
  (``decision_function < SCORE_THRESHOLD``), so normal activity is not flagged
  at a fixed rate.
* **No poisoning.** Only closed buckets that were *not* flagged are used for
  training; the manual ``report-activity`` endpoint scores without recording.
* **Never blocks requests.** Refits run in a background thread; scoring uses
  the last fitted model.
* **Persistent.** Closed buckets are saved to ``data_dir/ml/anomaly_windows.json``
  and reloaded on start. State is per process: run one worker.
"""

import json
import logging
import math
import threading
import time
from collections import deque

import numpy as np

log = logging.getLogger("campus_nexus.ml.anomaly")

WINDOW_SECONDS = 30
HISTORY = 2000
MIN_SAMPLES = 20          # closed buckets needed before the model is trusted
REFIT_EVERY = 25          # refit after this many new training samples
MIN_EVENTS_FOR_ML = 20    # smaller buckets cannot be a mass-change burst
SCORE_THRESHOLD = -0.05   # decision_function below this = isolated
Z_GATE = 2.5              # robust z-score (median/MAD) needed on a magnitude feature
RULE_TOTAL = 500
RULE_DELETES = 100

WINDOW: deque = deque(maxlen=HISTORY)      # closed, trusted training samples

_lock = threading.Lock()
_model = None
_gate = None              # (median, mad) arrays for the magnitude features
_samples_at_fit = 0
_seen_since_fit = 0
_fitting = False
_loaded = False

# live bucket: [start_ts, n_modified, n_deleted, n_created, mb, flagged]
_bucket = None


# ------------------------------------------------------------------ features
def features(n_modified: float, n_deleted: float, n_created: float, total_mb: float) -> list[float]:
    """log1p-scaled counts and volume plus the delete ratio (scale-robust)."""
    total = n_modified + n_deleted + n_created
    return [math.log1p(n_modified), math.log1p(n_deleted), math.log1p(n_created),
            math.log1p(max(0.0, total_mb)), (n_deleted / total) if total else 0.0]


def magnitude(n_modified: float, n_deleted: float, n_created: float, total_mb: float) -> list[float]:
    return [math.log1p(n_modified + n_deleted + n_created), math.log1p(n_deleted),
            math.log1p(max(0.0, total_mb))]


def robust_z(x: list[float], gate) -> float:
    med, mad = gate
    z = 0.6745 * (np.asarray(x) - med) / np.maximum(mad, 0.1)
    return float(np.max(z))


# ------------------------------------------------------------------ persistence
def _history_file():
    from app.core.config import settings
    d = settings.data_path / "ml"
    d.mkdir(parents=True, exist_ok=True)
    return d / "anomaly_windows.json"


def _load_locked():
    global _loaded
    if _loaded:
        return
    _loaded = True
    try:
        f = _history_file()
        if f.exists():
            for row in json.loads(f.read_text())[-HISTORY:]:
                WINDOW.append([float(x) for x in row])
    except Exception:
        log.exception("could not load anomaly history; starting empty")


def _save_locked():
    try:
        _history_file().write_text(json.dumps(list(WINDOW)))
    except Exception:
        log.exception("could not persist anomaly history")


# ------------------------------------------------------------------ training
def record_window(n_modified: int, n_deleted: int, n_created: int, total_mb: float, persist: bool = True):
    """Add one closed, trusted bucket to the training history."""
    global _seen_since_fit
    with _lock:
        _load_locked()
        WINDOW.append([float(n_modified), float(n_deleted), float(n_created), float(total_mb)])
        _seen_since_fit += 1
        if persist:
            _save_locked()
    _maybe_refit_async()


def _train(rows: list) -> tuple:
    """Fit forest + magnitude gate on a snapshot of the history (no lock held)."""
    from sklearn.ensemble import IsolationForest
    X = np.array([features(*row) for row in rows], dtype=float)
    model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    model.fit(X)
    M = np.array([magnitude(*row) for row in rows], dtype=float)
    med = np.median(M, axis=0)
    mad = np.median(np.abs(M - med), axis=0)
    return model, (med, mad)


def _install(trained: tuple, n_rows: int, seen_at_snapshot: int):
    global _model, _gate, _samples_at_fit, _seen_since_fit
    with _lock:
        (_model, _gate), _samples_at_fit = trained, n_rows
        _seen_since_fit = max(0, _seen_since_fit - seen_at_snapshot)


def fit_now():
    """Synchronous refit (tests / startup)."""
    with _lock:
        _load_locked()
        rows, seen = list(WINDOW), _seen_since_fit
    if len(rows) >= MIN_SAMPLES:
        _install(_train(rows), len(rows), seen)


def _maybe_refit_async():
    global _fitting
    with _lock:
        stale = (_model is None or _seen_since_fit >= REFIT_EVERY) and len(WINDOW) >= MIN_SAMPLES
        if not stale or _fitting:
            return
        _fitting = True
        rows, seen = list(WINDOW), _seen_since_fit

    def run():
        global _fitting
        try:
            _install(_train(rows), len(rows), seen)
        except Exception:
            log.exception("IsolationForest refit failed")
        finally:
            _fitting = False

    threading.Thread(target=run, daemon=True).start()


# ------------------------------------------------------------------ scoring
def is_anomalous(n_modified: int, n_deleted: int, n_created: int, total_mb: float) -> tuple[bool, float]:
    """Score one bucket's totals. Returns (anomaly, score); lower = more anomalous."""
    total = n_modified + n_deleted + n_created
    if total > RULE_TOTAL or n_deleted > RULE_DELETES:
        return True, -1.0
    if total < MIN_EVENTS_FOR_ML:
        return False, 0.0
    with _lock:
        _load_locked()
        model, gate = _model, _gate
    if model is None:
        _maybe_refit_async()
        return False, 0.0
    try:
        score = float(model.decision_function(
            np.array([features(n_modified, n_deleted, n_created, total_mb)], dtype=float))[0])
        z = robust_z(magnitude(n_modified, n_deleted, n_created, total_mb), gate)
    except Exception:
        log.exception("IsolationForest scoring failed; rule-only for this call")
        return False, 0.0
    return (score < SCORE_THRESHOLD and z > Z_GATE), score


def _roll_locked(now: float):
    """Close the current bucket if its window has passed. Returns closed sample or None."""
    global _bucket
    if _bucket is None:
        _bucket = [now, 0, 0, 0, 0.0, False]
        return None
    if now - _bucket[0] < WINDOW_SECONDS:
        return None
    closed = _bucket
    _bucket = [now, 0, 0, 0, 0.0, False]
    total = closed[1] + closed[2] + closed[3]
    if total and not closed[5]:
        return closed[1:5]
    return None


def observe(kind: str, size_mb: float, now: float | None = None, count: int = 1) -> tuple[bool, float, dict]:
    """Add ``count`` file events of one kind to the live bucket and score the bucket.

    kind: "modified" | "deleted" | "created"; size_mb is the total size.
    """
    now = time.time() if now is None else now
    with _lock:
        closed = _roll_locked(now)
        b = _bucket
        b[{"modified": 1, "deleted": 2, "created": 3}.get(kind, 1)] += max(1, int(count))
        b[4] += max(0.0, float(size_mb))
        counts = {"modified": b[1], "deleted": b[2], "created": b[3], "mb": round(b[4], 3),
                  "window_s": WINDOW_SECONDS}
        already = b[5]
    if closed is not None:
        record_window(*closed)
    anomalous, score = is_anomalous(counts["modified"], counts["deleted"], counts["created"], counts["mb"])
    if anomalous:
        with _lock:
            if _bucket is b:
                b[5] = True          # never train on a flagged bucket
    # report only the transition into "anomalous" so callers pause once
    return anomalous and not already, score, counts


def acknowledge_current():
    """Called when an admin resumes sync: discard the live (flagged) bucket."""
    global _bucket
    with _lock:
        _bucket = None


def reset():
    """Clear history, live bucket and cached model (tests)."""
    global _model, _gate, _samples_at_fit, _seen_since_fit, _bucket, _loaded
    with _lock:
        WINDOW.clear()
        _model = None
        _gate = None
        _samples_at_fit = 0
        _seen_since_fit = 0
        _bucket = None
        _loaded = True        # do not reload persisted history after a reset


def status() -> dict:
    with _lock:
        _load_locked()
        live = None
        if _bucket is not None:
            live = {"modified": _bucket[1], "deleted": _bucket[2], "created": _bucket[3],
                    "mb": round(_bucket[4], 3), "flagged": _bucket[5]}
        return {"windows_tracked": len(WINDOW), "model_fitted": _model is not None,
                "samples_at_last_fit": _samples_at_fit, "min_samples": MIN_SAMPLES,
                "refit_every": REFIT_EVERY, "window_seconds": WINDOW_SECONDS,
                "min_events_for_ml": MIN_EVENTS_FOR_ML, "live_window": live}
