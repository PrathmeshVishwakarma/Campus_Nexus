import re
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

PRIORITY_MAP = {"CRITICAL": 100, "URGENT": 80, "IMPORTANT": 60, "NORMAL": 40, "INFO": 10}
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserCreate(BaseModel):
    """Self-registration. The role is never client-controlled."""
    model_config = ConfigDict(extra="ignore")

    username: str
    email: str
    password: str

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip()
        if not _USERNAME_RE.match(v):
            raise ValueError("username must be 3-64 chars: letters, digits, _ . -")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("invalid email address")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("password must be at least 6 characters")
        return v


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str
    role: str


class RoleUpdate(BaseModel):
    role: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class EventCreate(BaseModel):
    """Internal event model used by the services."""
    type: str
    actor: str = "system"
    resource: str = ""
    priority: int = 50
    payload: dict[str, Any] = {}
    vector_clock: dict[str, int] = {}


class EventIn(BaseModel):
    """Client-submitted event. Actor is always the caller; priority is capped."""
    type: str = Field(min_length=1, max_length=64)
    resource: str = Field(default="", max_length=512)
    priority: int = Field(default=50, ge=0, le=60)
    payload: dict[str, Any] = {}


class EventOut(EventCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    timestamp: datetime


class MessageCreate(BaseModel):
    channel_id: int
    content: str = Field(min_length=1, max_length=8000)
    file_link: str = ""


class ChannelCreate(BaseModel):
    name: str
    type: str = "group"
    members: list[str] = []


class ChannelRename(BaseModel):
    name: str


class ChannelMembersUpdate(BaseModel):
    add: list[str] = []
    remove: list[str] = []


class AlertCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    body: str = Field(default="", max_length=8000)
    priority: str = "NORMAL"
    target_scope: str = "all"

    @field_validator("priority")
    @classmethod
    def _prio(cls, v: str) -> str:
        v = (v or "").upper()
        if v not in PRIORITY_MAP:
            raise ValueError(f"priority must be one of {list(PRIORITY_MAP)}")
        return v


class RootUpdate(BaseModel):
    path: str


class FolderACLUpdate(BaseModel):
    members: list[str] = []


class FolderMembersUpdate(BaseModel):
    add: list[str] = []
    remove: list[str] = []


class FileCommentCreate(BaseModel):
    file_path: str
    content: str


class FolderDiffFile(BaseModel):
    path: str
    sha256: str = ""
    size: int = 0


class FolderDiffRequest(BaseModel):
    base: str = ""
    files: list[FolderDiffFile] = []


class SyncComplete(BaseModel):
    """Finalize an upload.

    base_version: the version the client's copy was based on (from the manifest
      it saw before editing). If someone committed a newer version in between,
      the upload is recorded as a VERSION_CONFLICT.
    clock: optional vector clock the client already holds (agents).
    size: final file size in bytes — required to assemble a file whose tail
      chunks were deduplicated (skipped).
    """
    base_version: Optional[int] = None
    clock: dict[str, int] = {}
    size: Optional[int] = Field(default=None, ge=0)
