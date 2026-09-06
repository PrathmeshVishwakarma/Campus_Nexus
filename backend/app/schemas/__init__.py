from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class UserCreate(BaseModel):
    username: str
    email: str
    password: str
    role: str = "student"


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    role: str

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class EventCreate(BaseModel):
    type: str
    actor: str = "system"
    resource: str = ""
    priority: int = 50
    payload: dict[str, Any] = {}
    vector_clock: dict[str, int] = {}


class EventOut(EventCreate):
    id: str
    timestamp: datetime

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    channel_id: int
    content: str
    file_link: str = ""


class ChannelCreate(BaseModel):
    name: str
    type: str = "group"
    members: list[str] = []


class AlertCreate(BaseModel):
    title: str
    body: str
    priority: str = "NORMAL"
    target_scope: str = "all"


class ShareFolderCreate(BaseModel):
    name: str
    path: str


PRIORITY_MAP = {"CRITICAL": 100, "URGENT": 80, "IMPORTANT": 60, "NORMAL": 40, "INFO": 10}
