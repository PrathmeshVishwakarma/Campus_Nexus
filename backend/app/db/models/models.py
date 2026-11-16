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
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RootConfig(Base):
    """Singleton (id=1) holding the single shared root folder location."""
    __tablename__ = "root_config"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    path: Mapped[str] = mapped_column(String(1024), default="shared/demo_files")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow,
                                                 onupdate=datetime.utcnow)


class FolderACL(Base):
    """Per-top-level-subfolder member list. No row = public to all users."""
    __tablename__ = "folder_acl"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subfolder: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    members: Mapped[list] = mapped_column(JSON, default=list)
    updated_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow,
                                                 onupdate=datetime.utcnow)


class FileThread(Base):
    """One discussion thread per file — detached from chat channels."""
    __tablename__ = "file_threads"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_path: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FileComment(Base):
    __tablename__ = "file_comments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("file_threads.id"), index=True)
    sender: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
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


class SharedFolderMember(Base):
    """ACL row: which users may access a restricted SharedFolder.

    A folder with NO member rows is public (everyone can see it). As soon as it
    has one or more rows, it is restricted to those usernames (plus its owner).
    """

    __tablename__ = "shared_folder_members"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("shared_folders.id"), index=True)
    username: Mapped[str] = mapped_column(String(64), index=True)
    permission: Mapped[str] = mapped_column(String(16), default="edit")  # view | edit


class AppSetting(Base):
    """Simple key/value store for node-level settings (e.g. the shared root path)."""

    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class NotificationPreference(Base):
    """Per-user notification settings (Feature 3)."""

    __tablename__ = "notification_preferences"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)          # master switch
    enable_messages: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_file_events: Mapped[bool] = mapped_column(Boolean, default=True)
    enable_alerts: Mapped[bool] = mapped_column(Boolean, default=True)
    min_alert_priority: Mapped[str] = mapped_column(String(16), default="INFO")
    mute_channel_ids: Mapped[list] = mapped_column(JSON, default=list)
    mute_folder_paths: Mapped[list] = mapped_column(JSON, default=list)
    dnd_start: Mapped[str] = mapped_column(String(5), default="")         # "HH:MM" or ""
    dnd_end: Mapped[str] = mapped_column(String(5), default="")
    sound: Mapped[bool] = mapped_column(Boolean, default=True)
    desktop_toast: Mapped[bool] = mapped_column(Boolean, default=True)
    email_digest: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
