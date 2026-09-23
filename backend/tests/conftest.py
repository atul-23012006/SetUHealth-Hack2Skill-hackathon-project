"""Shared pytest fixtures."""
import pytest

from app.routers import public
from app.services import db, forecasting, genai, live_data, store


_REAL_DB_RESET = db.reset_all


@pytest.fixture
def real_db_reset():
    """The genuine ``db.reset_all``, for tests that point ``db.DB_PATH`` at a
    throwaway file first. Never call it against the developer's real ledger."""
    return _REAL_DB_RESET


@pytest.fixture(autouse=True)
def _never_wipe_the_real_store(monkeypatch):
    """The suite runs against the developer's real generated dataset and SQLite
    ledger. Resetting either would silently destroy their demo state, so any test
    that reaches a reset fails loudly instead. A test that needs reset behaviour
    must stub the function itself."""

    def refuse(*args, **kwargs):
        raise AssertionError("a test tried to reset the real store/ledger; stub it instead")

    monkeypatch.setattr(store, "reset_store_data", refuse)
    monkeypatch.setattr(db, "reset_all", refuse)
    yield


@pytest.fixture(autouse=True)
def _no_live_network(monkeypatch):
    """No test may reach a real public API (weather, World Bank, OpenStreetMap).
    The single network seam is stubbed to "unavailable" and the cache emptied;
    tests that exercise live data install their own fake over the same seam."""

    def offline(*args, **kwargs):
        raise live_data.LiveDataError("network disabled in tests")

    monkeypatch.setattr(live_data, "_request", offline)
    monkeypatch.setattr(genai, "_client_ready", False)  # no test may call the real Gemini API
    monkeypatch.setattr(live_data.settings, "signal_polling_enabled", False)
    monkeypatch.setattr(live_data.settings, "alert_webhook_url", "")
    genai._down_until.clear()  # circuit-breaker state must not leak between tests
    monkeypatch.setattr(live_data.settings, "live_cache_persist", False)  # never touch the real SQLite cache
    live_data.clear_cache()
    public.limiter.reset()  # per-IP counters would otherwise leak between tests
    yield
    live_data.clear_cache()


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


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """A throwaway SQLite file, so tests that write notifications, cache rows or
    ledger entries never touch the developer's real database."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    return db
