from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC 'now' (the DB stores naive UTC timestamps).

    Replaces the deprecated ``datetime.utcnow()``.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
