import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import jwt
from passlib.context import CryptContext

from app.core.config import settings

log = logging.getLogger("campus_nexus.security")
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

ROLES = ("student", "faculty", "staff", "admin")
_WEAK_KEYS = {"", "change-me-to-a-long-random-secret-in-prod", "change-me"}


def _load_secret_key() -> str:
    """Use SECRET_KEY if set; otherwise generate one and persist it.

    Persisting keeps tokens valid across restarts without ever falling back to a
    hard-coded, publicly known key.
    """
    if settings.secret_key not in _WEAK_KEYS:
        if len(settings.secret_key) < 32:
            log.warning("SECRET_KEY is shorter than 32 characters; use a longer random value")
        return settings.secret_key
    key_file = settings.data_path / "secret_key"
    if key_file.exists():
        key = key_file.read_text().strip()
        if key:
            return key
    key = secrets.token_urlsafe(48)
    key_file.write_text(key)
    log.warning("SECRET_KEY not set; generated one at %s", key_file)
    return key


SECRET_KEY = _load_secret_key()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=settings.algorithm)


def decode_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[settings.algorithm])
