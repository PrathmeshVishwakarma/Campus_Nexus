"""IsolationForest anomaly detection over file-activity windows."""

from collections import deque

import numpy as np

WINDOW = deque(maxlen=500)


def record_window(n_modified: int, n_deleted: int, n_created: int, total_mb: float):
    WINDOW.append([n_modified, n_deleted, n_created, total_mb])


def is_anomalous(n_modified: int, n_deleted: int, n_created: int, total_mb: float) -> tuple[bool, float]:
    """Rule + ML hybrid. Returns (anomaly, score)."""
    total = n_modified + n_deleted + n_created
    # Hard rule: mass modification (ransomware-like)
    if total > 500 or n_deleted > 100:
        return True, -1.0
    if len(WINDOW) < 20:
        return False, 0.0
    try:
        from sklearn.ensemble import IsolationForest
        X = np.array(WINDOW)
        model = IsolationForest(contamination=0.05, random_state=42)
        model.fit(X)
        score = float(model.decision_function([[n_modified, n_deleted, n_created, total_mb]])[0])
        return score < 0, score
    except Exception:
        return False, 0.0
