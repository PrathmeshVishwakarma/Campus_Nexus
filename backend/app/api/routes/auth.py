from fastapi import APIRouter, Depends, HTTPException
from jose import JWTError
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.security import create_access_token, decode_token, hash_password, verify_password
from app.db.models.models import User
from app.db.session import get_db
from app.schemas import Token, UserCreate, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(token: str = Depends(oauth2), db: Session = Depends(get_db)) -> User:
    try:
        payload = decode_token(token)
        username = payload.get("sub")
    except JWTError:
        raise HTTPException(401, "Invalid token")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


@router.post("/register", response_model=UserOut)
def register(data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter((User.username == data.username) | (User.email == data.email)).first():
        raise HTTPException(400, "User exists")
    u = User(username=data.username, email=data.email,
             hashed_password=hash_password(data.password), role=data.role)
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
    return db.query(User).all()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
