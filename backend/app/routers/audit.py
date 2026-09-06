from fastapi import APIRouter, Query

from app.services import db

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def get_audit_log(limit: int = Query(100, le=500)):
    """Chronological audit trail of every state mutation (transfers, crises,
    resets) recorded in the SQLite ledger, newest first."""
    return db.list_events(limit)
