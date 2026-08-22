from fastapi import APIRouter

from app.services import forecasting, genai

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
def get_alerts(state: str | None = None, limit: int = 20):
    return forecasting.network_alerts(state)[:limit]


@router.get("/{phc_id}/{medicine}/explain")
def explain(phc_id: str, medicine: str, lang: str = "en"):
    alert = forecasting.forecast_medicine(phc_id, medicine)
    from app.services.store import PHC_BY_ID

    phc = PHC_BY_ID[phc_id]
    alert.update({"phc_name": phc["name"], "state": phc["state"], "district": phc["district"]})
    return {"explanation": genai.explain_alert(alert, lang)}
