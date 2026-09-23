from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.routers.public import limiter
from app.services import auth, db

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


@router.get("/config")
def auth_config():
    """Which mode the server runs in, so the frontend can show a sign-in page or
    the demo identity picker. Public: it reveals nothing sensitive."""
    return {"mode": "token" if auth.token_mode() else "demo"}


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest):
    if not auth.token_mode():
        raise HTTPException(status_code=400, detail="Token authentication is not enabled on this server")
    user = auth.authenticate(body.user_id, body.password)
    if not user:
        db.log_event("login_failed", f"Failed sign-in for '{body.user_id[:64]}'", {"user_id": body.user_id[:64]})
        # One message for unknown user, wrong password and disabled account alike.
        raise HTTPException(status_code=401, detail="Invalid user id or password")
    token, ttl = auth.create_token(user["user_id"])
    db.log_event("login", f"{user['label']} signed in", {"user_id": user["user_id"]})
    return {"access_token": token, "token_type": "bearer", "expires_in": ttl, "user": user}


@router.get("/users")
def list_users(_: None = Depends(auth.require_console_access)):
    """Demo mode: the fixed roster the frontend's "acting as" picker offers
    (selecting one sends its id as X-User-Id). Token mode: requires a session."""
    return auth.list_users()


@router.get("/me")
def whoami(user: dict | None = Depends(auth.get_current_user_optional)):
    """The caller's resolved identity (or null): the demo header's user, or the
    bearer token's user in token mode."""
    return {"user": user}
