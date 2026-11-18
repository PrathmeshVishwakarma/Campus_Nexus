from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import ROLES, create_access_token, decode_token, hash_password, verify_password
from app.db.models.models import User
from app.db.session import get_db
from app.schemas import RoleUpdate, Token, UserCreate, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def user_from_token(token: str, db: Session) -> User | None:
    try:
        username = decode_token(token).get("sub")
    except JWTError:
        return None
    if not username:
        return None
    return db.query(User).filter(User.username == username).first()


def get_current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    user = user_from_token(token, db)
    if not user:
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


def is_admin(user: User) -> bool:
    return (user.role or "").lower() == "admin"


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not is_admin(user):
        raise HTTPException(403, "Admin only")
    return user


def promote_configured_admins(db: Session) -> None:
    """Make every username in ADMIN_USERNAMES an admin (idempotent)."""
    names = settings.admin_username_set
    if not names:
        return
    changed = False
    for u in db.query(User).filter(User.username.in_(names)).all():
        if u.role != "admin":
            u.role = "admin"
            changed = True
    if changed:
        db.commit()


@router.post("/register", response_model=UserOut)
def register(data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter((User.username == data.username) | (User.email == data.email)).first():
        raise HTTPException(400, "User exists")
    # Role is never taken from the client. The very first account bootstraps
    # the deployment as admin; ADMIN_USERNAMES can name further admins.
    first_user = db.query(User.id).first() is None
    role = "admin" if (first_user or data.username in settings.admin_username_set) else "student"
    u = User(username=data.username, email=data.email,
             hashed_password=hash_password(data.password), role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.username == form.username).first()
    if not u or not verify_password(form.password, u.hashed_password):
        raise HTTPException(401, "Bad credentials")
    return Token(access_token=create_access_token({"sub": u.username}))


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(User).order_by(User.username).all()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/users/{username}/role", response_model=UserOut)
def set_role(username: str, data: RoleUpdate, db: Session = Depends(get_db),
             admin: User = Depends(require_admin)):
    role = (data.role or "").lower()
    if role not in ROLES:
        raise HTTPException(400, f"role must be one of {list(ROLES)}")
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(404, "User not found")
    if target.username == admin.username and role != "admin":
        remaining = db.query(User).filter(User.role == "admin", User.username != admin.username).count()
        if remaining == 0:
            raise HTTPException(400, "Cannot demote the last admin")
    target.role = role
    db.commit()
    db.refresh(target)
    return target
