from fastapi import APIRouter

from app.services import forecasting

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


@router.get("")
def get_forecast(state: str | None = None):
    return forecasting.forecast_all(state)


@router.get("/{phc_id}/{medicine}")
def get_forecast_for(phc_id: str, medicine: str):
    return forecasting.forecast_medicine(phc_id, medicine)
