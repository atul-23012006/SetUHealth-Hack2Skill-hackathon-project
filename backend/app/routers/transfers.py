from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.services import auth, db, transfers

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


class TransferRequest(BaseModel):
    from_phc_id: str
    to_phc_id: str
    medicine: str
    quantity: float
    # When true, the system also attempts to auto-dispatch a simulated
    # courier inline — see services/transfers.py's eligibility gate.
    # Ineligible transfers (large, cross-state, or destination-critical)
    # execute exactly as before regardless of this flag.
    auto_execute: bool = False


class PendingTransferPing(BaseModel):
    from_phc_id: str
    to_phc_id: str
    medicine: str
    quantity: float


@router.get("")
def list_transfers():
    return transfers.load_transfers()


@router.post("")
def execute_transfer(req: TransferRequest, user: dict = Depends(auth.get_current_user)):
    try:
        auth.authorize_transfer(user, req.from_phc_id)
    except auth.TransferNotAuthorized as e:
        db.log_event(
            "transfer_rejected",
            f"{user['label']} denied: {e}",
            {**req.model_dump(), "user_id": user["user_id"]},
        )
        raise HTTPException(status_code=403, detail=str(e))

    try:
        manifest = transfers.create_and_execute_transfer(
            req.from_phc_id, req.to_phc_id, req.medicine, req.quantity,
            requested_by=user["user_id"], auto_execute=req.auto_execute,
        )
        return {"status": "success", "manifest": manifest}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pending")
def log_pending_transfer(ping: PendingTransferPing):
    """Best-effort trace for a transfer attempted while the client was offline.

    Called with ``navigator.sendBeacon`` from the offline branch of the
    frontend's ``executeTransfer`` — sendBeacon requests can't carry custom
    headers, so this is intentionally unauthenticated and never applies the
    transfer. It exists purely so the attempt leaves a server-side breadcrumb
    even if the browser's local ``offline_transfers`` queue is later lost
    (storage cleared, device switched) before a real sync can run.
    """
    db.log_event(
        "transfer_attempted_offline",
        f"Facility {ping.from_phc_id} attempted to send {ping.quantity} {ping.medicine} "
        f"to {ping.to_phc_id} while offline (not yet applied — pending local sync)",
        ping.model_dump(),
    )
    return {"status": "logged"}
