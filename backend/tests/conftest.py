"""Shared pytest fixtures."""
import pytest

from app.services import forecasting, store


@pytest.fixture
def synthetic_facility():
    """Register a throwaway facility in the store and clean it up after.

    Location defaults match test_resource_genericity.py's original fixture
    (Pune, Maharashtra) so existing single-facility tests are unaffected;
    pass state/district/lat/lon explicitly when a test needs two facilities
    in different states (e.g. testing cross-state behaviour) or a specific
    distance apart.
    """
    created = []

    def _make(
        facility_id: str,
        facility_type: str,
        stock: dict,
        visits: list[int] | None = None,
        state: str = "Maharashtra",
        district: str = "Pune",
        lat: float = 18.52,
        lon: float = 73.85,
    ):
        facility = {
            "id": facility_id,
            "name": f"Test {facility_type} {facility_id}",
            "state": state,
            "district": district,
            "lat": lat,
            "lon": lon,
            "beds_total": 0,
            "staff": [],
            "facility_type": facility_type,
        }
        store.PHCS.append(facility)
        store.PHC_BY_ID[facility_id] = facility
        store.STOCK_HISTORY[facility_id] = stock
        store.BED_HISTORY[facility_id] = {"occupied": [0] * 90}
        store.STAFF_HISTORY[facility_id] = {"attendance_pct": [90] * 90}
        if visits is not None:
            store.FOOTFALL_HISTORY[facility_id] = {"visits": visits}
        created.append(facility_id)
        forecasting.clear_forecast_cache()
        return facility

    yield _make

    for facility_id in created:
        store.PHCS[:] = [p for p in store.PHCS if p["id"] != facility_id]
        store.PHC_BY_ID.pop(facility_id, None)
        store.STOCK_HISTORY.pop(facility_id, None)
        store.BED_HISTORY.pop(facility_id, None)
        store.STAFF_HISTORY.pop(facility_id, None)
        store.FOOTFALL_HISTORY.pop(facility_id, None)
    forecasting.clear_forecast_cache()

    # A test that calls services.transfers.create_and_execute_transfer on a
    # synthetic facility triggers store.save_stock_history(), which persists
    # the *entire* in-memory STOCK_HISTORY — including the synthetic
    # facility — to app/data/generated/stock_history.json. Flushing again
    # now, after the pops above, overwrites that file with the clean
    # in-memory state so no orphaned test facility ever survives on disk.
    if created:
        store.save_stock_history()
