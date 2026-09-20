"""IsolationForest anomaly detection over file-activity windows.

Design notes
------------
* Hybrid detector: a hard rule catches obvious mass-modify / mass-delete bursts
  (ransomware-like), and an IsolationForest catches statistically unusual
  windows relative to recent history.
* The model is cached and only refit every ``REFIT_EVERY`` new samples instead
  of on every call, so scoring is cheap.
* All shared state is guarded by a lock: the file-watcher thread calls
  ``record_window`` while API requests call ``is_anomalous``.
* Failures are logged, not silently swallowed. If the ML path fails we fall
  back to the hard rule only.
"""

import logging
import threading
from collections import deque

import numpy as np

log = logging.getLogger("campus_nexus.ml.anomaly")

WINDOW: deque = deque(maxlen=500)
MIN_SAMPLES = 20        # need this much history before the model is trusted
REFIT_EVERY = 25        # refit the forest after this many new samples
CONTAMINATION = 0.05

_lock = threading.Lock()
_model = None
_samples_at_fit = 0
_seen_since_fit = 0


def record_window(n_modified: int, n_deleted: int, n_created: int, total_mb: float):
    global _seen_since_fit
    with _lock:
        WINDOW.append([n_modified, n_deleted, n_created, total_mb])
        _seen_since_fit += 1


def _get_model():
    """Return a fitted IsolationForest, refitting only when stale. Caller holds _lock."""
    global _model, _samples_at_fit, _seen_since_fit
    stale = _model is None or _seen_since_fit >= REFIT_EVERY
    if stale:
        from sklearn.ensemble import IsolationForest
        X = np.array(WINDOW, dtype=float)
        _model = IsolationForest(contamination=CONTAMINATION, random_state=42)
        _model.fit(X)
        _samples_at_fit = len(X)
        _seen_since_fit = 0
    return _model


def reset():
    """Clear history and cached model (used by tests)."""
    global _model, _samples_at_fit, _seen_since_fit
    with _lock:
        WINDOW.clear()
        _model = None
        _samples_at_fit = 0
        _seen_since_fit = 0


def status() -> dict:
    with _lock:
        return {"windows_tracked": len(WINDOW), "model_fitted": _model is not None,
                "samples_at_last_fit": _samples_at_fit,
                "min_samples": MIN_SAMPLES, "refit_every": REFIT_EVERY}


def is_anomalous(n_modified: int, n_deleted: int, n_created: int, total_mb: float) -> tuple[bool, float]:
    """Rule + ML hybrid. Returns (anomaly, score). Lower score = more anomalous."""
    total = n_modified + n_deleted + n_created
    # Hard rule: mass modification / deletion (ransomware-like)
    if total > 500 or n_deleted > 100:
        return True, -1.0
    with _lock:
        if len(WINDOW) < MIN_SAMPLES:
            return False, 0.0
        try:
            model = _get_model()
            score = float(model.decision_function(
                np.array([[n_modified, n_deleted, n_created, total_mb]], dtype=float))[0])
            return score < 0, score
        except Exception:
            log.exception("IsolationForest scoring failed; falling back to rule-only")
            return False, 0.0