"""Minimal identity + authorization layer.

There is no real login flow here (hackathon scope) — the frontend lets the
demo operator pick "who they are acting as" from a fixed roster, and every
request carries that choice as an ``X-User-Id`` header. This is enough to
close the actual gap: before this module existed, ``POST /api/transfers``
(and the assistant's natural-language transfer action) would move stock out
of *any* facility for *anyone*, with no identity attached at all.

Roles:
* ``phc_operator``      — may only move stock out of their own facility.
* ``state_coordinator`` — may move stock out of any facility in their state.
* ``national_admin``    — may move stock out of any facility nationwide.

Swap ``USERS`` for a real identity provider / database table without
touching the callers — they only depend on ``get_current_user``,
``get_current_user_optional`` and ``authorize_transfer``.
"""
import base64
import hashlib
import hmac
import logging
import secrets
import time

import jwt
from fastapi import Header, HTTPException

from app.config import settings
from app.services import db, store

logger = logging.getLogger(__name__)

USERS: dict[str, dict] = {
    "phc_operator_001": {
        "user_id": "phc_operator_001",
        "label": "PHC Operator — Pune PHC 1 (Maharashtra)",
        "role": "phc_operator",
        "authorized_phc_ids": ["PHC-0001"],
        "authorized_states": [],
    },
    "phc_operator_128": {
        "user_id": "phc_operator_128",
        "label": "PHC Operator — PHC-0128 (Kerala)",
        "role": "phc_operator",
        "authorized_phc_ids": ["PHC-0128"],
        "authorized_states": [],
    },
    "state_coordinator_mh": {
        "user_id": "state_coordinator_mh",
        "label": "State Coordinator — Maharashtra",
        "role": "state_coordinator",
        "authorized_phc_ids": [],
        "authorized_states": ["Maharashtra"],
    },
    "state_coordinator_bihar": {
        "user_id": "state_coordinator_bihar",
        "label": "State Coordinator — Bihar",
        "role": "state_coordinator",
        "authorized_phc_ids": [],
        "authorized_states": ["Bihar"],
    },
    "national_admin": {
        "user_id": "national_admin",
        "label": "National Administrator (all states)",
        "role": "national_admin",
        "authorized_phc_ids": [],
        "authorized_states": ["*"],
    },
}


class TransferNotAuthorized(Exception):
    """Raised when a resolved user is not permitted to move stock out of a facility."""


# ---------------------------------------------------------------------------
# Token mode: scrypt password hashes + signed, short-lived JWTs
# ---------------------------------------------------------------------------

def token_mode() -> bool:
    return settings.auth_mode == "token"


_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
_EPHEMERAL_SECRET = secrets.token_urlsafe(48)
ISSUER = "setuhealth"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


# A well-formed hash of a random password, verified against when the user id is
# unknown so a bad user id and a bad password take the same time.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(12))


def _secret() -> str:
    return settings.jwt_secret or _EPHEMERAL_SECRET


def create_token(user_id: str) -> tuple[str, int]:
    now = int(time.time())
    ttl = int(settings.token_ttl_hours * 3600)
    token = jwt.encode({"sub": user_id, "iat": now, "exp": now + ttl, "iss": ISSUER}, _secret(), algorithm="HS256")
    return token, ttl


def decode_token(token: str) -> str | None:
    """The user id a valid, unexpired token was issued to, else None."""
    try:
        claims = jwt.decode(token, _secret(), algorithms=["HS256"], issuer=ISSUER, options={"require": ["exp", "sub", "iss"]})
        return claims["sub"]
    except jwt.PyJWTError:
        return None


def ensure_seeded() -> None:
    """Create the account table's initial rows from the demo roster. Passwords
    come from DEMO_USER_PASSWORD; if that is unset a random one is generated and
    logged once (a fixed default password would be a published credential)."""
    if db.user_count() > 0:
        return
    password = settings.demo_user_password
    generated = not password
    if generated:
        password = secrets.token_urlsafe(12)
    hashed = hash_password(password)
    for user in USERS.values():
        db.user_upsert(user, hashed)
    if generated:
        logger.warning(
            "AUTH_MODE=token and DEMO_USER_PASSWORD is not set: generated password for the %d seeded accounts: %s "
            "(shown once; set DEMO_USER_PASSWORD to choose your own)", len(USERS), password,
        )


def authenticate(user_id: str, password: str) -> dict | None:
    ensure_seeded()
    row = db.user_get(user_id)
    ok = verify_password(password, row["password_hash"] if row else _DUMMY_HASH)
    if not row or not ok or not row["active"]:
        return None
    return _public_user(row)


def _public_user(row: dict) -> dict:
    """The roster-shaped dict the rest of the app uses; never carries the hash."""
    return {k: row[k] for k in ("user_id", "label", "role", "authorized_phc_ids", "authorized_states")}


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _user_from_bearer(authorization: str | None) -> dict | None:
    token = _bearer(authorization)
    user_id = decode_token(token) if token else None
    if not user_id:
        return None
    row = db.user_get(user_id)  # authorization is read fresh, so a deactivated user is cut off at once
    return _public_user(row) if row and row["active"] else None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> dict:
    """Required-identity dependency. Token mode: a valid Bearer token (the
    X-User-Id header is ignored, so it cannot be spoofed). Demo mode: the
    X-User-Id header must name a known demo user. Both 401 when absent; the
    headers are declared optional to FastAPI so a missing one reaches this check
    (a required Header(...) would fail request validation first and surface as a
    generic 422, which isn't the semantic we want for "no identity presented")."""
    if token_mode():
        user = _user_from_bearer(authorization)
        if not user:
            raise _unauthorized("Sign in required")
        return user
    if not x_user_id or x_user_id not in USERS:
        raise HTTPException(status_code=401, detail="Unknown or missing user (X-User-Id header)")
    return USERS[x_user_id]


def get_current_user_optional(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> dict | None:
    """Best-effort identity resolution: returns None instead of raising, for endpoints
    (like the assistant chat) that serve unauthenticated queries but must still gate
    the specific mutating actions they can trigger."""
    if token_mode():
        return _user_from_bearer(authorization)
    if not x_user_id:
        return None
    return USERS.get(x_user_id)


def require_console_access(
    authorization: str | None = Header(None),
) -> None:
    """Router-level guard for the officer console's API. A no-op in demo mode;
    in token mode every request needs a valid session."""
    if token_mode() and not _user_from_bearer(authorization):
        raise _unauthorized("Sign in required")


def is_authorized_for_phc(user: dict, phc_id: str) -> bool:
    if "*" in user.get("authorized_states", []):
        return True
    if phc_id in user.get("authorized_phc_ids", []):
        return True
    phc = store.PHC_BY_ID.get(phc_id)
    return bool(phc and phc["state"] in user.get("authorized_states", []))


def authorize_transfer(user: dict | None, from_phc_id: str) -> None:
    """Raise TransferNotAuthorized unless ``user`` may move stock out of ``from_phc_id``.
    Used by both the manual transfer form (routers/transfers.py) and the AI
    assistant's parsed transfer action (routers/assistant.py) — the two front
    doors onto ``services.transfers.create_and_execute_transfer``."""
    if not user:
        raise TransferNotAuthorized("No authenticated user identified (missing or unknown X-User-Id)")
    if not is_authorized_for_phc(user, from_phc_id):
        raise TransferNotAuthorized(
            f"{user['label']} is not authorized to move stock out of facility {from_phc_id}"
        )


def list_users() -> list[dict]:
    """Roster for the frontend's \"acting as\" picker. No secrets in here — it's
    just a fixed set of demo identities, not a credential store."""
    return list(USERS.values())
