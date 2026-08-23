from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import transfers

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


class TransferRequest(BaseModel):
    from_phc_id: str
    to_phc_id: str
    medicine: str
    quantity: float


@router.get("")
def list_transfers():
    return transfers.load_transfers()


@router.post("")
def execute_transfer(req: TransferRequest):
    try:
        manifest = transfers.create_and_execute_transfer(
            req.from_phc_id, req.to_phc_id, req.medicine, req.quantity
        )
        return {"status": "success", "manifest": manifest}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
