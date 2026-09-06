from fastapi import APIRouter, Query

from app.services import anomaly

router = APIRouter(prefix="/api/anomalies", tags=["anomalies"])


@router.get("")
def list_anomalies(state: str | None = None):
    """Facilities whose medicine consumption is inconsistent with patient footfall,
    worst first. Rediscovered from the network ratio distribution, not from labels."""
    return anomaly.detect_all(state)


@router.get("/{phc_id}/explain")
def explain_anomaly(phc_id: str, lang: str = Query("en")):
    """Full anomaly record for one PHC plus an AI-written investigator note."""
    return anomaly.explain(phc_id, lang)
