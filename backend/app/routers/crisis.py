from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import store

router = APIRouter(prefix="/api/crisis", tags=["crisis"])


class CrisisRequest(BaseModel):
    target_type: str  # "state" | "district" | "all"
    target_name: str  # e.g., "Pune", "Maharashtra"
    crisis_type: str  # "Dengue Outbreak" | "Malaria Outbreak" | "Monsoon Floods" | "Cold Chain Failure"
    # 1.0 = a typical instance of the crisis type (store.CRISIS_SEVERITY);
    # scales how much stock/beds/footfall move, not what moves.
    intensity: float = Field(default=1.0, ge=store.INTENSITY_MIN, le=store.INTENSITY_MAX)


@router.post("/trigger")
def trigger(req: CrisisRequest):
    try:
        impact = store.trigger_crisis(req.target_type, req.target_name, req.crisis_type, req.intensity)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"status": "success", "active_crises": store.ACTIVE_CRISES, "impact": impact}


@router.get("/severity")
def get_severity():
    """The transparent per-crisis-type planning assumptions (store.CRISIS_SEVERITY)
    and the allowed intensity range, so the UI can show what a severity dial means."""
    return {"severity": store.CRISIS_SEVERITY, "intensity_min": store.INTENSITY_MIN, "intensity_max": store.INTENSITY_MAX}


@router.post("/reset")
def reset():
    store.reset_store_data()
    return {"status": "success", "message": "All data and active crises have been reset."}


@router.get("/active")
def get_active():
    return store.ACTIVE_CRISES


@router.get("/impact")
def get_impact():
    """Before/after record of every simulated crisis this session, newest first."""
    return list(reversed(store.CRISIS_IMPACTS))
