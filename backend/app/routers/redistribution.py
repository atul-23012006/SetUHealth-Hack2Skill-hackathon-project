from fastapi import APIRouter, Query

from app.services import redistribution, genai, forecasting

router = APIRouter(prefix="/api/redistribution", tags=["redistribution"])


@router.get("")
def get_recommendations(
    state: str | None = None,
    explain: bool = Query(False, description="Pre-load AI explanations for top critical/warning recs"),
    lang: str = Query("en", description="Language code for AI explanations (en, hi, mr, ta)"),
):
    """Return redistribution recommendations. Pass explain=true to pre-load AI explanations
    for the top 8 critical/warning transfers (adds ~1-2 seconds for Gemini round-trips)."""
    recs = redistribution.recommend_all(state)
    if explain:
        recs = redistribution.enrich_with_explanations(recs, lang=lang)
    return recs


@router.get("/capacity")
def get_capacity_recommendations(state: str | None = None):
    """Non-medicine redistribution: bed-overflow diversions and staff-shortage
    support, matched to the nearest facility with genuine spare capacity."""
    return redistribution.recommend_capacity(state)


@router.get("/{from_phc_id}/{to_phc_id}/{medicine}/explain")
def explain_recommendation(
    from_phc_id: str,
    to_phc_id: str,
    medicine: str,
    lang: str = Query("en"),
):
    """Return an AI-generated plain-language rationale for a redistribution recommendation."""
    from_forecast = forecasting.forecast_medicine(from_phc_id, medicine)
    to_forecast = forecasting.forecast_medicine(to_phc_id, medicine)

    rec = {
        "medicine": medicine,
        "unit": from_forecast.get("unit", "units"),
        "quantity": "?",  # not passed in; explanation doesn't need exact qty
        "from_phc_name": from_forecast.get("phc_name", from_phc_id),
        "from_district": from_forecast.get("district", ""),
        "from_state": from_forecast.get("state", ""),
        "to_phc_name": to_forecast.get("phc_name", to_phc_id),
        "to_district": to_forecast.get("district", ""),
        "to_state": to_forecast.get("state", ""),
    }
    explanation = genai.explain_transfer(rec, from_forecast, to_forecast, lang)
    return {"explanation": explanation}

