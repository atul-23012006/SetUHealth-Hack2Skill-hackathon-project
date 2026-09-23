from fastapi import APIRouter, HTTPException, Query

from app.services import forecasting, genai, live_data, weather_impact

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("")
def get_alerts(
    state: str | None = None,
    limit: int = 20,
    weather_adjusted: bool = Query(False, description="Overlay the real weather outlook as a demand scenario"),
    intensity: float = Query(1.0, ge=0.0, le=2.0),
):
    if weather_adjusted:
        try:
            return weather_impact.alerts(state, intensity)[:limit]
        except live_data.LiveDataError as exc:
            raise HTTPException(status_code=503, detail=str(exc))
    return forecasting.network_alerts(state)[:limit]


@router.get("/{phc_id}/{medicine}/explain")
def explain(phc_id: str, medicine: str, lang: str = "en"):
    alert = forecasting.forecast_medicine(phc_id, medicine)
    from app.services import store

    phc = store.PHC_BY_ID[phc_id]
    alert.update({"phc_name": phc["name"], "state": phc["state"], "district": phc["district"]})
    return {"explanation": genai.explain_alert(alert, lang)}
