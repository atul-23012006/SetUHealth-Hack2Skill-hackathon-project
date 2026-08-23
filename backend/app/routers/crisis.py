from fastapi import APIRouter
from pydantic import BaseModel

from app.services import store

router = APIRouter(prefix="/api/crisis", tags=["crisis"])


class CrisisRequest(BaseModel):
    target_type: str  # "state" | "district" | "all"
    target_name: str  # e.g., "Pune", "Maharashtra"
    crisis_type: str  # "Dengue Outbreak" | "Malaria Outbreak" | "Monsoon Floods"


@router.post("/trigger")
def trigger(req: CrisisRequest):
    store.trigger_crisis(req.target_type, req.target_name, req.crisis_type)
    return {"status": "success", "active_crises": store.ACTIVE_CRISES}


@router.post("/reset")
def reset():
    store.reset_store_data()
    return {"status": "success", "message": "All data and active crises have been reset."}


@router.get("/active")
def get_active():
    return store.ACTIVE_CRISES
