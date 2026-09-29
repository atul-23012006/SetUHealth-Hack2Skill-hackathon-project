"""The crisis simulator changes the data it claims to, and reports every change
as a before/after row so the dashboard can show exactly what moved."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import store

client = TestClient(app)
DISTRICT = "Crisistest"


def _stock(level: float, unit: str = "strip") -> dict:
    return {"unit": unit, "category": "general", "capacity": 500, "reorder_level": 50, "levels": [level] * 90}


@pytest.fixture
def isolated(monkeypatch, temp_db, synthetic_facility):
    """Crisis runs against throwaway facilities; nothing is written to disk, the
    real ledger or the real crisis/cold-chain state."""
    for name in ("save_stock_history", "save_bed_history", "save_footfall_history"):
        monkeypatch.setattr(store, name, lambda: None)
    monkeypatch.setattr(store, "ACTIVE_CRISES", [])
    monkeypatch.setattr(store, "CRISIS_IMPACTS", [])
    monkeypatch.setattr(store, "COLD_CHAIN_FAILURES", set())
    monkeypatch.setattr(store, "COLD_CHAIN_TEMPS", {})

    def make(fid: str, stock: dict):
        f = synthetic_facility(fid, "PHC", stock, visits=[100] * 90, district=DISTRICT)
        f["beds_total"] = 10
        store.BED_HISTORY[fid] = {"occupied": [3] * 90}
        return f

    return make


def test_outbreak_crashes_stock_fills_beds_and_reports_each_change(isolated):
    isolated("TEST-CR-1", {"Paracetamol 500mg": _stock(400), "ORS Sachets": _stock(400, "sachet")})

    impact = store.trigger_crisis("district", DISTRICT, "Dengue Outbreak")

    levels = store.STOCK_HISTORY["TEST-CR-1"]["Paracetamol 500mg"]["levels"]
    # Depletes, but a typical-intensity outbreak leaves a real remainder —
    # not the old behaviour of crashing every facility to exactly zero.
    assert 0 < levels[-1] < 400
    beds_after = store.BED_HISTORY["TEST-CR-1"]["occupied"][-1]
    # Bed surge closes part of the gap to full capacity (10), not all of it —
    # the old behaviour forced every affected facility to exactly 100%.
    assert 3 < beds_after < 10
    visits_after = store.FOOTFALL_HISTORY["TEST-CR-1"]["visits"][-1]
    assert 100 < visits_after < 180  # up from baseline, below the uncapped 1.8x multiplier

    assert impact["simulated"] is True
    assert impact["intensity"] == 1.0
    by_kind = {(r["kind"], r["item"]): r for r in impact["changes"]}
    para = by_kind[("stock", "Paracetamol 500mg")]
    assert (para["before"], para["after"]) == (400, levels[-1])
    assert para["risk_before"] == "low"
    assert by_kind[("beds", "Beds occupied")]["before"] == 3
    assert by_kind[("beds", "Beds occupied")]["after"] == beds_after
    assert by_kind[("footfall", "OPD visits today")]["after"] == visits_after

    t = impact["totals"]
    assert t["facilities_affected"] == 1
    assert t["stock_items_changed"] == 2
    assert t["beds_newly_occupied"] == beds_after - 3
    assert t["extra_opd_visits"] == visits_after - 100
    assert store.CRISIS_IMPACTS == [impact]


def test_higher_intensity_causes_more_depletion_than_lower_intensity(isolated):
    isolated("TEST-CR-8", {"Paracetamol 500mg": _stock(400)})
    mild = store.trigger_crisis("district", DISTRICT, "Dengue Outbreak", intensity=0.25)
    mild_level = store.STOCK_HISTORY["TEST-CR-8"]["Paracetamol 500mg"]["levels"][-1]

    store.ACTIVE_CRISES.clear()  # otherwise the second call collides with the dedupe check
    isolated("TEST-CR-9", {"Paracetamol 500mg": _stock(400)})
    severe = store.trigger_crisis("district", DISTRICT, "Dengue Outbreak", intensity=2.0)
    severe_level = store.STOCK_HISTORY["TEST-CR-9"]["Paracetamol 500mg"]["levels"][-1]

    assert severe_level < mild_level
    assert mild["intensity"] == 0.25
    assert severe["intensity"] == 2.0


@pytest.mark.parametrize("intensity", [0.0, 0.1, 2.5, 10])
def test_intensity_outside_the_allowed_range_is_rejected(isolated, intensity):
    isolated("TEST-CR-10", {"Paracetamol 500mg": _stock(400)})
    with pytest.raises(ValueError, match="intensity"):
        store.trigger_crisis("district", DISTRICT, "Dengue Outbreak", intensity=intensity)
    assert store.ACTIVE_CRISES == []


def test_facilities_are_not_all_drained_identically(isolated):
    # Regression: previously every facility in a state-wide crisis crashed to
    # an identical value (0 stock, 100% beds) — a state-wide crisis should
    # not read as more scripted than a single-facility one.
    isolated("TEST-CR-11-A", {"Paracetamol 500mg": _stock(400)})
    isolated("TEST-CR-11-B", {"Paracetamol 500mg": _stock(400)})
    isolated("TEST-CR-11-C", {"Paracetamol 500mg": _stock(400)})

    store.trigger_crisis("district", DISTRICT, "Monsoon Floods")

    finals = {
        fid: store.STOCK_HISTORY[fid]["Paracetamol 500mg"]["levels"][-1]
        for fid in ("TEST-CR-11-A", "TEST-CR-11-B", "TEST-CR-11-C")
    }
    assert len(set(finals.values())) > 1


def test_malaria_outbreak_does_not_surge_beds(isolated):
    # store.CRISIS_SEVERITY: malaria is mostly outpatient care.
    isolated("TEST-CR-12", {"Artesunate Injection": _stock(400)})
    store.trigger_crisis("district", DISTRICT, "Malaria Outbreak")
    assert store.BED_HISTORY["TEST-CR-12"]["occupied"][-1] == 3


def test_cold_chain_failure_reports_temperature_rows_and_moves_no_stock(isolated):
    isolated("TEST-CR-2", {"Oxytocin Injection": _stock(300, "ampoule"), "Paracetamol 500mg": _stock(300)})

    impact = store.trigger_crisis("district", DISTRICT, "Cold Chain Failure")

    assert store.STOCK_HISTORY["TEST-CR-2"]["Oxytocin Injection"]["levels"][-1] == 300
    rows = impact["changes"]
    assert [r["kind"] for r in rows] == ["temperature"]
    assert rows[0]["item"] == "Oxytocin Injection"
    assert rows[0]["after"] == 12.4
    assert impact["totals"]["cold_chain_alerts_raised"] == 1


def test_trigger_endpoint_returns_impact_and_impact_endpoint_lists_newest_first(isolated):
    isolated("TEST-CR-3", {"Paracetamol 500mg": _stock(400)})

    r = client.post("/api/crisis/trigger", json={"target_type": "district", "target_name": DISTRICT, "crisis_type": "Monsoon Floods"})
    assert r.status_code == 200
    assert r.json()["impact"]["crisis_type"] == "Monsoon Floods"
    client.post("/api/crisis/trigger", json={"target_type": "district", "target_name": DISTRICT, "crisis_type": "Malaria Outbreak"})

    listed = client.get("/api/crisis/impact").json()
    assert [i["crisis_type"] for i in listed] == ["Malaria Outbreak", "Monsoon Floods"]


@pytest.mark.parametrize("body", [
    {"target_type": "district", "target_name": "Nowhere", "crisis_type": "Monsoon Floods"},
    {"target_type": "district", "target_name": DISTRICT, "crisis_type": "Alien Invasion"},
])
def test_unknown_target_or_crisis_is_rejected_without_recording_a_crisis(isolated, body):
    isolated("TEST-CR-4", {"Paracetamol 500mg": _stock(400)})
    r = client.post("/api/crisis/trigger", json=body)
    assert r.status_code == 400
    assert store.ACTIVE_CRISES == []
    assert store.STOCK_HISTORY["TEST-CR-4"]["Paracetamol 500mg"]["levels"][-1] == 400


def test_retriggering_the_same_crisis_is_rejected_and_does_not_double_apply(isolated):
    isolated("TEST-CR-6", {"Paracetamol 500mg": _stock(400)})

    store.trigger_crisis("district", DISTRICT, "Monsoon Floods")
    level_after_first = store.STOCK_HISTORY["TEST-CR-6"]["Paracetamol 500mg"]["levels"][-1]

    with pytest.raises(ValueError, match="already active"):
        store.trigger_crisis("district", DISTRICT, "Monsoon Floods")

    assert store.STOCK_HISTORY["TEST-CR-6"]["Paracetamol 500mg"]["levels"][-1] == level_after_first
    assert len(store.ACTIVE_CRISES) == 1
    assert len(store.CRISIS_IMPACTS) == 1


def test_a_different_crisis_on_the_same_target_is_still_allowed(isolated):
    isolated("TEST-CR-7", {"Paracetamol 500mg": _stock(400), "Artesunate Injection": _stock(400)})

    store.trigger_crisis("district", DISTRICT, "Monsoon Floods")
    store.trigger_crisis("district", DISTRICT, "Malaria Outbreak")

    assert [c["crisis_type"] for c in store.ACTIVE_CRISES] == ["Monsoon Floods", "Malaria Outbreak"]


def test_severity_endpoint_exposes_the_planning_assumptions(isolated):
    r = client.get("/api/crisis/severity")
    assert r.status_code == 200
    body = r.json()
    assert body["intensity_min"] == store.INTENSITY_MIN
    assert body["intensity_max"] == store.INTENSITY_MAX
    assert set(body["severity"]) == set(store.CRISIS_DEPLETION)
    for rule in body["severity"].values():
        assert "why" in rule and rule["why"]


def test_facility_variance_is_deterministic_and_bounded(isolated):
    v1 = store._facility_variance("PHC-x", "Dengue Outbreak")
    v2 = store._facility_variance("PHC-x", "Dengue Outbreak")
    assert v1 == v2  # reproducible
    assert 1.0 - store.CRISIS_VARIANCE <= v1 <= 1.0 + store.CRISIS_VARIANCE
    # Different facility or different crisis type -> (almost certainly) a different value.
    assert store._facility_variance("PHC-y", "Dengue Outbreak") != v1
    assert store._facility_variance("PHC-x", "Monsoon Floods") != v1


def test_scaled_fraction_is_capped_and_never_negative(isolated):
    assert store._scaled_fraction(0.8, 2.0, 1.25) <= 0.97
    assert store._scaled_fraction(0.8, 0.25, 0.75) >= 0.0
    assert store._scaled_fraction(0.0, 1.0, 1.0) == 0.0


def test_outbreak_never_raises_stock_at_a_facility_below_capacity(isolated):
    # Regression: the crash used to restart from full capacity (500), so a
    # facility holding 120 units ended the "outbreak" with more stock.
    isolated("TEST-CR-5", {"ORS Sachets": _stock(120, "sachet")})
    before = list(store.STOCK_HISTORY["TEST-CR-5"]["ORS Sachets"]["levels"])
    store.trigger_crisis("district", DISTRICT, "Monsoon Floods")
    after = store.STOCK_HISTORY["TEST-CR-5"]["ORS Sachets"]["levels"]
    assert all(a <= b for a, b in zip(after, before, strict=True))
    assert after[-1] < 120
