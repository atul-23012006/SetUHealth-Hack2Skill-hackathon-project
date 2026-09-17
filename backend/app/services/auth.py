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
from fastapi import Header, HTTPException

from app.services import store

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


def get_current_user(x_user_id: str | None = Header(None, alias="X-User-Id")) -> dict:
    """Required-identity FastAPI dependency: 401s if the header is missing or
    unknown. The header itself is declared optional to FastAPI (Header(None))
    so a missing header reaches this check and gets a 401 — a required
    Header(...) would instead fail FastAPI's own request validation first
    and surface as a generic 422, which isn't the semantic we want for
    "no identity presented"."""
    if not x_user_id or x_user_id not in USERS:
        raise HTTPException(status_code=401, detail="Unknown or missing user (X-User-Id header)")
    return USERS[x_user_id]


def get_current_user_optional(x_user_id: str | None = Header(None, alias="X-User-Id")) -> dict | None:
    """Best-effort identity resolution: returns None instead of raising, for endpoints
    (like the assistant chat) that serve unauthenticated queries but must still gate
    the specific mutating actions they can trigger."""
    if not x_user_id:
        return None
    return USERS.get(x_user_id)


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
