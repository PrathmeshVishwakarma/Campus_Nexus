"""Run every test against a throwaway database, shared root and data dir.

The environment must be set before ``app`` is imported, because settings,
the engine and the secret key are created at import time.
"""
import os
import shutil
import tempfile
import uuid
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="nexus_test_"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["SHARED_FOLDER"] = str(_TMP / "root")
os.environ["DATA_DIR"] = str(_TMP / "data")
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough-1234567890"
os.environ["ADMIN_USERNAMES"] = "admin_root"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

_client = TestClient(app)


@pytest.fixture(scope="session")
def client():
    return _client


@pytest.fixture(scope="session")
def tmp_root() -> Path:
    return _TMP / "root"


def make_user(client, name: str | None = None):
    u = name or f"u_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/auth/register", json={"username": u, "email": f"{u}@x.com", "password": "pass123"})
    assert r.status_code == 200, r.text
    t = client.post("/api/auth/login", data={"username": u, "password": "pass123"}).json()["access_token"]
    return u, {"Authorization": f"Bearer {t}"}, t


# Register the admin first: the very first account on an empty DB becomes admin.
_ADMIN = make_user(_client, "admin_root")


@pytest.fixture
def user(client):
    return make_user(client)


@pytest.fixture(scope="session")
def admin():
    return _ADMIN


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)
