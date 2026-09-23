"""Real-world data endpoints. Thin wrappers over ``services/live_data.py``:
an unreachable upstream is a 503 (never a fabricated answer), bad input a 400."""
from fastapi import APIRouter, HTTPException, Query, Request

from app.routers.public import limiter
from app.services import live_data, weather_impact

router = APIRouter(prefix="/api/live", tags=["live data"])

# Per-IP limits. These endpoints fan out to third-party APIs, so an unthrottled
# client could burn our quota with them (responses are cached, but unique
# queries and coordinates are not).
LIMIT_LIGHT = "60/minute"    # cheap, cached, or purely local
LIMIT_UPSTREAM = "30/minute"
LIMIT_OSM = "12/minute"      # Overpass is the most fragile upstream


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except live_data.LiveDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/weather/states")
@limiter.limit(LIMIT_UPSTREAM)
def weather_by_state(request: Request):
    """Real weather and derived operational signals at each state's centroid."""
    return _call(live_data.state_weather)


@router.get("/weather")
@limiter.limit(LIMIT_UPSTREAM)
def weather_at(request: Request, lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    """Real weather, signals and air quality at one point."""
    return _call(live_data.place_snapshot, lat, lon)


@router.get("/geocode")
@limiter.limit(LIMIT_LIGHT)
def search_places(request: Request, q: str = Query(..., min_length=2, max_length=80), country: str | None = Query("IN", min_length=2, max_length=2)):
    """Place search (Open-Meteo geocoding). Defaults to India."""
    return _call(live_data.geocode, q, country.upper() if country else None)


@router.get("/benchmarks/catalog")
@limiter.limit(LIMIT_LIGHT)
def benchmark_catalog(request: Request):
    return live_data.benchmark_catalog()


@router.get("/benchmarks")
@limiter.limit(LIMIT_UPSTREAM)
def benchmarks(request: Request, indicator: str = Query(...), countries: str | None = Query(None, description="comma-separated ISO3 codes")):
    """World Bank health-system indicator series for BRICS countries."""
    wanted = [c.strip().upper() for c in countries.split(",") if c.strip()] if countries else None
    return _call(live_data.benchmarks, indicator, wanted)


@router.get("/facilities/osm")
@limiter.limit(LIMIT_OSM)
def osm_facilities(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(8, ge=1, le=25),
):
    """Real hospitals/clinics near a point, from OpenStreetMap."""
    return _call(live_data.osm_facilities, lat, lon, radius_km)


@router.get("/facility-benchmarks")
@limiter.limit(LIMIT_LIGHT)
def facility_count_benchmarks(request: Request, states: str | None = Query(None, description="comma-separated state names")):
    """Real (but historical) official facility counts alongside this demo
    network's own facility count, for the same states."""
    wanted = [s.strip() for s in states.split(",") if s.strip()] if states else None
    return _call(live_data.facility_count_benchmarks, wanted)


@router.get("/facilities/network")
@limiter.limit(LIMIT_LIGHT)
def network_facilities(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    limit: int = Query(12, ge=1, le=50),
    radius_km: float | None = Query(None, ge=1, le=2000),
):
    """The SetuHealth network's own (synthetic) facilities nearest a point."""
    return live_data.nearest_network_facilities(lat, lon, limit, radius_km)


@router.get("/impact")
@limiter.limit(LIMIT_UPSTREAM)
def weather_impact_summary(
    request: Request,
    state: str | None = Query(None),
    intensity: float = Query(1.0, ge=0.0, le=2.0, description="Scales the demand assumptions (0 = none, 1 = as listed, 2 = double the excess)"),
):
    """Which facility/medicine pairs the real weather outlook could push toward
    a stockout, under transparent planning assumptions. Never changes stored data."""
    return _call(weather_impact.impact, state, intensity)
