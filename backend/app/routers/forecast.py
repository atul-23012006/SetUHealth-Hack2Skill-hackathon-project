import gzip
import json

from fastapi import APIRouter, Request, Response
from fastapi.encoders import jsonable_encoder

from app.services import forecasting

router = APIRouter(prefix="/api/forecast", tags=["forecast"])


def forecast_json(state: str | None = None) -> tuple[bytes, bytes]:
    """The national forecast is ~270 KB of JSON; re-serializing it per request
    took ~4s on a 0.1-CPU host even with the forecasts themselves cached. The
    encoded bytes live in the forecast cache's sibling, so they're dropped by
    the same clear_forecast_cache() that invalidates the data they came from."""
    key = ("forecast_json", state)
    if key not in forecasting.DERIVED_CACHE:
        raw = json.dumps(jsonable_encoder(forecasting.forecast_all(state))).encode()
        # Compressed once here as well: gzipping 2 MB per request in the
        # middleware cost ~1s of CPU each time on the same 0.1-CPU host.
        forecasting.DERIVED_CACHE[key] = (raw, gzip.compress(raw, compresslevel=6))
    return forecasting.DERIVED_CACHE[key]


@router.get("")
def get_forecast(request: Request, state: str | None = None):
    raw, packed = forecast_json(state)
    if "gzip" in request.headers.get("accept-encoding", ""):
        return Response(content=packed, media_type="application/json", headers={"Content-Encoding": "gzip"})
    return Response(content=raw, media_type="application/json")


@router.get("/{phc_id}/{medicine}")
def get_forecast_for(phc_id: str, medicine: str):
    return forecasting.forecast_medicine(phc_id, medicine)
