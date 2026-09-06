"""SQLAlchemy models — single source of truth for Campus Nexus."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(32), default="student")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SharedFolder(Base):
    __tablename__ = "shared_folders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    path: Mapped[str] = mapped_column(String(512))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FileVersion(Base):
    __tablename__ = "file_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_path: Mapped[str] = mapped_column(String(512), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    hash_sha256: Mapped[str] = mapped_column(String(64), index=True)
    chunks: Mapped[dict] = mapped_column(JSON, default=list)
    size: Mapped[int] = mapped_column(Integer, default=0)
    modified_by: Mapped[str] = mapped_column(String(64), default="unknown")
    vector_clock: Mapped[dict] = mapped_column(JSON, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Event(Base):
    """Unified event log — heart of the system."""

    __tablename__ = "events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: f"evt_{uuid.uuid4().hex[:8]}")
    type: Mapped[str] = mapped_column(String(64), index=True)
    actor: Mapped[str] = mapped_column(String(64), default="system")
    resource: Mapped[str] = mapped_column(String(512), default="", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=50)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    vector_clock: Mapped[dict] = mapped_column(JSON, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(32), default="group")  # dm|group|department|file
    members: Mapped[dict] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("channels.id"), index=True)
    sender: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
    file_link: Mapped[str] = mapped_column(String(512), default="")
    delivered: Mapped[bool] = mapped_column(Boolean, default=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: f"alr_{uuid.uuid4().hex[:8]}")
    title: Mapped[str] = mapped_column(String(256))
    body: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(32), default="NORMAL")
    sender: Mapped[str] = mapped_column(String(64), default="system")
    target_scope: Mapped[str] = mapped_column(String(64), default="all")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AlertReceipt(Base):
    __tablename__ = "alert_receipts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    alert_id: Mapped[str] = mapped_column(ForeignKey("alerts.id"), index=True)
    user: Mapped[str] = mapped_column(String(64), index=True)
    delivered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    acked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)


class Peer(Base):
    __tablename__ = "peers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hostname: Mapped[str] = mapped_column(String(128), unique=True)
    ip: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="online")
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SyncTask(Base):
    __tablename__ = "sync_tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_path: Mapped[str] = mapped_column(String(512))
    priority: Mapped[int] = mapped_column(Integer, default=40)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    retries: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
