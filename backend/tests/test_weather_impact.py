"""Weather-scenario overlay: transparent, bounded, and never a change to stored data."""
import copy

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import forecasting, live_data, redistribution, store, weather_impact

client = TestClient(app)
STATE = "Maharashtra"


def _weather(*signals, state=STATE):
    """A fake ``state_weather()`` payload with the given (id, level) signals for one state."""
    return {
        "source": "test", "fetched_at": "2026-09-21T00:00:00Z", "stale": False,
        "states": [{
            "state": state, "level": max((lv for _, lv in signals), key=["normal", "elevated", "high"].index, default="normal"),
            "signals": [{"id": i, "label": i, "level": lv, "reason": "", "suggested_crisis": None} for i, lv in signals],
        }],
    }


def _falling_stock(current, slope=1.0, resource_id="ors_sachets", unit="sachet", category="general"):
    """A stock record consuming ``slope`` units/day, ending at ``current``."""
    return {
        "resource_id": resource_id, "unit": unit, "category": category, "capacity": 600, "reorder_level": 50,
        "levels": [current + (89 - i) * slope for i in range(90)],
    }


@pytest.fixture
def facility(synthetic_facility):
    def make(fid, medicine="ORS Sachets", current=70, state=STATE, **kw):
        return synthetic_facility(fid, "PHC", {medicine: _falling_stock(current, **kw)}, state=state)

    return make


def _by_id(forecasts, phc_id, medicine="ORS Sachets"):
    return next(f for f in forecasts if f["phc_id"] == phc_id and f["medicine"] == medicine)


def test_flood_signal_pushes_an_ors_facility_from_low_to_warning(facility, monkeypatch):
    facility("TEST-WX-1", current=70)
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    base = _by_id(forecasting.forecast_all(), "TEST-WX-1")
    assert base["risk"] == "low"

    adj = _by_id(weather_impact.adjusted_forecasts(), "TEST-WX-1")
    assert adj["weather_adjusted"] is True and adj["weather_factor"] == 2.0
    assert adj["risk"] == "warning" and adj["baseline_risk"] == "low"
    assert adj["days_to_stockout"] < adj["baseline_days_to_stockout"]
    assert adj["weather_causes"][0]["signal"] == "flood"


def test_unaffected_pairs_are_returned_exactly_as_stored(facility, monkeypatch):
    facility("TEST-WX-2", medicine="Paracetamol 500mg", current=70)      # flood does not touch paracetamol
    facility("TEST-WX-3", current=70, state="Kerala")                     # the signal is for Maharashtra only
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    adjusted = weather_impact.adjusted_forecasts()
    for fid, med in (("TEST-WX-2", "Paracetamol 500mg"), ("TEST-WX-3", "ORS Sachets")):
        assert _by_id(adjusted, fid, med) == _by_id(forecasting.forecast_all(), fid, med)
        assert "weather_adjusted" not in _by_id(adjusted, fid, med)


def test_no_active_signals_means_the_scenario_equals_the_baseline(monkeypatch):
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "normal"), ("heat", "normal")))
    assert weather_impact.adjusted_forecasts() == forecasting.forecast_all()


def test_intensity_zero_is_no_effect_and_higher_intensity_is_worse(facility, monkeypatch):
    facility("TEST-WX-4", current=70)
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    assert weather_impact.impact(intensity=0.0)["totals"]["pairs_affected"] == 0
    strong = _by_id(weather_impact.adjusted_forecasts(intensity=2.0), "TEST-WX-4")
    normal = _by_id(weather_impact.adjusted_forecasts(intensity=1.0), "TEST-WX-4")
    assert strong["weather_factor"] == 3.0 and strong["days_to_stockout"] < normal["days_to_stockout"]
    assert strong["risk"] == "critical" and normal["risk"] == "warning"


def test_a_scenario_never_makes_stock_look_healthier(monkeypatch):
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high"), ("vector", "high"), ("heat", "high")))
    rank = {"low": 0, "warning": 1, "critical": 2}
    base = {(f["phc_id"], f["medicine"]): f for f in forecasting.forecast_all()}
    for f in weather_impact.adjusted_forecasts():
        b = base[(f["phc_id"], f["medicine"])]
        assert rank[f["risk"]] >= rank[b["risk"]]
        if f["days_to_stockout"] is not None and b["days_to_stockout"] is not None:
            assert f["days_to_stockout"] <= b["days_to_stockout"]


def test_the_scenario_does_not_modify_stored_forecasts_or_stock(facility, monkeypatch):
    facility("TEST-WX-5", current=70)
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    before_forecasts = copy.deepcopy(forecasting.forecast_all())
    before_stock = copy.deepcopy(store.STOCK_HISTORY["TEST-WX-5"])
    weather_impact.impact()
    weather_impact.alerts()
    assert forecasting.forecast_all() == before_forecasts
    assert store.STOCK_HISTORY["TEST-WX-5"] == before_stock


def test_several_signals_on_one_medicine_use_the_largest_factor_not_their_product(monkeypatch):
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high"), ("heat", "high")))
    ors = weather_impact.state_factors()[STATE]["ORS Sachets"]
    assert ors["factor"] == 2.0                      # flood high (2.0) beats heat high (1.6); not 3.2
    assert {c["signal"] for c in ors["causes"]} == {"flood", "heat"}


def test_impact_summary_is_transparent_and_counts_worsened_pairs(facility, monkeypatch):
    facility("TEST-WX-6", current=70)
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    out = weather_impact.impact()
    assert "Planning assumptions" in out["disclaimer"]
    assert any(a["signal"] == "flood" and a["medicine"] == "ORS Sachets" for a in out["assumptions"])
    row = next(i for i in out["items"] if i["phc_id"] == "TEST-WX-6")
    assert (row["risk_before"], row["risk_after"]) == ("low", "warning")
    assert out["totals"]["pairs_worsened"] >= 1
    st = next(s for s in out["states"] if s["state"] == STATE)
    assert "ORS Sachets" in st["medicines_affected"] and st["pairs_worsened"] >= 1


def test_heat_is_reported_as_cold_chain_exposure_not_folded_into_stockouts(facility, monkeypatch):
    facility("TEST-WX-7", medicine="Insulin (Human)", current=200, resource_id="insulin_human", unit="vial", category="chronic")
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("heat", "high")))
    out = weather_impact.impact()
    assert out["totals"]["cold_chain_items_exposed_to_heat"] >= 1
    assert "Insulin (Human)" not in weather_impact.state_factors().get(STATE, {})   # no demand effect assumed


def test_redistribution_accepts_an_injected_forecast_set():
    assert redistribution.recommend_all(forecasts=[]) == []                            # nothing to plan over
    assert isinstance(redistribution.recommend_all(), list)                            # default path unchanged


def test_scenario_recommendations_run_over_adjusted_forecasts(monkeypatch):
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high"), ("vector", "high")))
    recs = weather_impact.recommendations()
    assert isinstance(recs, list)
    for r in recs[:5]:
        assert {"from_phc_id", "to_phc_id", "medicine", "quantity"} <= set(r)


# ---------------------------------------------------------------- HTTP

def test_alerts_endpoint_only_adjusts_when_asked(facility, monkeypatch):
    facility("TEST-WX-8", current=70)
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    plain = client.get("/api/alerts", params={"limit": 500}).json()
    assert not any(a["phc_id"] == "TEST-WX-8" for a in plain)
    adjusted = client.get("/api/alerts", params={"limit": 500, "weather_adjusted": True}).json()
    hit = next(a for a in adjusted if a["phc_id"] == "TEST-WX-8")
    assert hit["risk"] == "warning" and hit["weather_adjusted"] is True


def test_scenario_alerts_list_weather_worsened_pairs_before_everything_else(facility, monkeypatch):
    facility("TEST-WX-9", current=70)                                    # low -> warning under the flood scenario
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "high")))
    alerts = weather_impact.alerts()
    first_unchanged = next(i for i, a in enumerate(alerts) if not a.get("weather_adjusted") or a["risk"] == a["baseline_risk"])
    worsened = [a for a in alerts if a.get("weather_adjusted") and a["risk"] != a["baseline_risk"]]
    assert any(a["phc_id"] == "TEST-WX-9" for a in worsened)
    assert all(alerts.index(a) < first_unchanged for a in worsened)      # every worsened pair precedes every other alert


def test_weather_adjusted_endpoints_return_503_when_the_feed_is_down():
    assert client.get("/api/alerts", params={"weather_adjusted": True}).status_code == 503
    assert client.get("/api/redistribution", params={"weather_adjusted": True}).status_code == 503
    assert client.get("/api/live/impact").status_code == 503


def test_impact_endpoint_validates_intensity(monkeypatch):
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(("flood", "elevated")))
    assert client.get("/api/live/impact", params={"intensity": 5}).status_code == 422
    assert client.get("/api/live/impact", params={"intensity": 1.5}).status_code == 200
