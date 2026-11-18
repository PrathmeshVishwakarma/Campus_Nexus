"""Who may see an event.

Every event is either public (audience ``None``) or restricted to a set of
usernames. The same rule is used for live WebSocket delivery and for the REST
timeline (``GET /api/events``, ``GET /api/files/activity``) so private data —
DM text, files in locked folders, targeted alerts — never leaks through either.
"""

from sqlalchemy.orm import Session

from app.db.models.models import AlertReceipt, Alert, Channel, FolderACL, User

FILE_EVENT_TYPES = {
    "FILE_CREATED", "FILE_MODIFIED", "FILE_DELETED", "FILE_COMMENT", "FILE_CONFLICT_RESOLVED",
    "FILE_RESTORED", "VERSION_CONFLICT", "SYNC_COMPLETED", "FOLDER_ACL_UPDATED",
    "FOLDER_CREATED", "ANOMALY_DETECTED",
}
ADMIN_ONLY_TYPES = {"ROOT_MOVED"}


def top_folder(rel: str) -> str:
    rel = (rel or "").replace("\\", "/").strip().lstrip("/")
    return rel.split("/")[0] if "/" in rel else ""


class AudienceResolver:
    """Resolves audiences with per-instance caching (one instance per request/batch)."""

    def __init__(self, db: Session):
        self.db = db
        self._acl: dict | None = None
        self._admins: set | None = None
        self._channels: dict[int, set | None] = {}
        self._alerts: dict[str, set | None] = {}

    # -- cached lookups
    def admins(self) -> set:
        if self._admins is None:
            self._admins = {u for (u,) in self.db.query(User.username).filter(User.role == "admin").all()}
        return self._admins

    def acl(self) -> dict:
        if self._acl is None:
            self._acl = {r.subfolder: set(r.members or []) for r in self.db.query(FolderACL).all()}
        return self._acl

    def _channel(self, cid: int) -> set:
        if cid not in self._channels:
            c = self.db.query(Channel).filter(Channel.id == cid).first()
            self._channels[cid] = set(c.members or []) if c else set()
        return self._channels[cid] or set()

    def _alert(self, alert_id: str) -> set | None:
        if alert_id not in self._alerts:
            a = self.db.query(Alert).filter(Alert.id == alert_id).first()
            if not a:
                self._alerts[alert_id] = set()
            elif (a.target_scope or "all") == "all":
                self._alerts[alert_id] = None
            else:
                users = {u for (u,) in self.db.query(AlertReceipt.user).filter(
                    AlertReceipt.alert_id == alert_id).all()}
                self._alerts[alert_id] = users | {a.sender} | self.admins()
        return self._alerts[alert_id]

    # -- rule
    def audience(self, etype: str, resource: str, payload: dict | None = None) -> set | None:
        resource = resource or ""
        if etype in ADMIN_ONLY_TYPES:
            return set(self.admins())
        if resource.startswith("channel:"):
            head = resource.split(" ", 1)[0]
            try:
                return set(self._channel(int(head.split(":", 1)[1])))
            except ValueError:
                return set()
        if etype.startswith("ALERT_"):
            return self._alert(resource)
        if etype in FILE_EVENT_TYPES or etype.startswith("FILE_"):
            top = top_folder(resource)
            if etype == "FOLDER_ACL_UPDATED" or etype == "FOLDER_CREATED":
                top = resource.strip("/").split("/")[0]
            members = self.acl().get(top) if top else None
            if members is None:
                return None
            return set(members) | self.admins()
        return None

    def can_view(self, username: str, etype: str, resource: str, payload: dict | None = None) -> bool:
        aud = self.audience(etype, resource, payload)
        return aud is None or username in aud
