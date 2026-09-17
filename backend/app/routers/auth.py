from fastapi import APIRouter, Depends

from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/users")
def list_users():
    """Fixed roster of demo identities the frontend lets the operator pick
    from ('acting as ...'). Selecting one sends its id as X-User-Id on every
    subsequent request."""
    return auth.list_users()


@router.get("/me")
def whoami(user: dict | None = Depends(auth.get_current_user_optional)):
    """Resolve the caller's current X-User-Id header, if any. Used by the
    frontend to validate a stored selection is still a known user."""
    return {"user": user}
