from fastapi import APIRouter, Query

from app.services import db

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def get_audit_log(limit: int = Query(100, le=500), phc_id: str | None = None):
    """Chronological audit trail of every state mutation (transfers, crises,
    resets) recorded in the SQLite ledger, newest first. Pass phc_id to scope
    to one facility's own history — only events that genuinely name a
    facility (transfers, dispatches) can match; see db.log_event."""
    return db.list_events(limit, phc_id=phc_id)
