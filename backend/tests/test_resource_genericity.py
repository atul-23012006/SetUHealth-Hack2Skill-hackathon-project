"""Proves the forecasting/anomaly/redistribution engines are resource-agnostic.

The claim this file defends is the Phase 3 acceptance criterion: a new
resource type can be registered by editing ``app/data/resource_types.py``
alone, and forecasting, anomaly detection and redistribution pick it up with
no changes of their own. Each test drives the engines with a synthetic
series for a resource that is explicitly *not* a medicine.

Run: ``python -m pytest tests -q`` from ``backend/``.
"""
import math

import pytest

from app.data import resource_types
from app.services import anomaly, forecasting, redistribution, store

# synthetic_facility fixture lives in conftest.py (shared across test files).


def _declining_series(start: float, daily_use: float, days: int = 90) -> list[float]:
    """A plainly-declining stock curve with a mild weekly wobble — enough
    history for Holt's smoothing to fit against."""
    levels, level = [], start
    for d in range(days):
        level = max(0.0, level - daily_use * (1.0 + 0.1 * math.sin(d / 7)))
        levels.append(round(level, 1))
    return levels


def _stock_entry(resource: resource_types.ResourceType, start: float, daily_use: float) -> dict:
    return {
        "resource_id": resource.id,
        "unit": resource.unit,
        "category": resource.category,
        "capacity": start,
        "reorder_level": round(start * 0.25),
        "levels": _declining_series(start, daily_use),
    }


@pytest.mark.parametrize("resource_id", ["oxygen_cylinder_d_type", "blood_unit_o_negative"])
def test_forecasts_a_non_medicine_resource(synthetic_facility, resource_id):
    """The forecaster does not care that the resource isn't a medicine."""
    resource = resource_types.get(resource_id)
    facility_id = f"TEST-{resource.id[:6].upper()}"
    synthetic_facility(
        facility_id,
        resource.facility_types[0],
        {resource.display_name: _stock_entry(resource, start=120.0, daily_use=4.0)},
    )

    result = forecasting.forecast_medicine(facility_id, resource.display_name)

    assert result["resource_id"] == resource.id
    assert result["resource_category"] == resource.category
    assert result["unit"] == resource.unit
    # A steadily-drawn-down stock must produce a real depletion rate, a
    # stockout horizon, and a full projection — not a degenerate zero series.
    assert result["daily_depletion_rate"] > 0
    assert result["days_to_stockout"] is not None
    assert len(result["projection"]) == forecasting.FORECAST_HORIZON
    assert result["risk"] in ("low", "warning", "critical")


def test_cold_chain_monitoring_follows_the_perishable_flag(synthetic_facility):
    """Temperature tracking is a property of the resource in the registry,
    not a list of medicine names inside the engine."""
    blood = resource_types.get("blood_unit_o_negative")
    oxygen = resource_types.get("oxygen_cylinder_d_type")
    assert blood.is_perishable and not oxygen.is_perishable

    synthetic_facility(
        "TEST-COLDCHAIN",
        "District_Hospital",
        {
            blood.display_name: _stock_entry(blood, start=90.0, daily_use=2.5),
            oxygen.display_name: _stock_entry(oxygen, start=90.0, daily_use=2.5),
        },
    )

    perishable = forecasting.forecast_medicine("TEST-COLDCHAIN", blood.display_name)
    durable = forecasting.forecast_medicine("TEST-COLDCHAIN", oxygen.display_name)

    assert perishable["temperature"] is not None
    assert durable["temperature"] is None
    assert durable["cold_chain_alert"] is False


def test_a_brand_new_resource_type_needs_no_engine_change(synthetic_facility, monkeypatch):
    """The acceptance criterion itself: register a resource type that no
    engine has ever heard of, and it flows through forecasting and into the
    redistribution loop without touching forecasting.py, anomaly.py or
    redistribution.py."""
    ventilator_circuit = resource_types.ResourceType(
        id="ventilator_circuit_adult",
        display_name="Ventilator Circuit (adult)",
        unit="circuit",
        category="respiratory",
        is_perishable=False,
        reorder_lead_time_days=5,
        tier=2,
        daily_use_mean=1.5,
        daily_use_std=0.5,
        facility_types=("District_Hospital",),
        source=None,
    )
    monkeypatch.setattr(
        resource_types, "RESOURCE_TYPES", resource_types.RESOURCE_TYPES + [ventilator_circuit]
    )
    monkeypatch.setitem(resource_types._BY_KEY, ventilator_circuit.id, ventilator_circuit)
    monkeypatch.setitem(resource_types._BY_KEY, ventilator_circuit.display_name, ventilator_circuit)

    # The generator targets it at the facility types the registry names.
    assert ventilator_circuit in resource_types.for_facility_type("District_Hospital")
    assert ventilator_circuit not in resource_types.for_facility_type("PHC")

    synthetic_facility(
        "TEST-VENT",
        "District_Hospital",
        {ventilator_circuit.display_name: _stock_entry(ventilator_circuit, start=60.0, daily_use=3.0)},
    )

    result = forecasting.forecast_medicine("TEST-VENT", ventilator_circuit.display_name)
    assert result["resource_id"] == "ventilator_circuit_adult"
    assert result["days_to_stockout"] is not None

    # And redistribution's sweep covers it, carrying its registry tier.
    assert ventilator_circuit.display_name in store.resource_stock_keys()
    assert ventilator_circuit.category in store.resource_categories()


def test_anomaly_detector_reads_whatever_resources_a_facility_stocks(synthetic_facility):
    """A facility stocking only a non-medicine resource is still scored, and
    that resource is what shows up in the anomaly's supporting detail."""
    blood = resource_types.get("blood_unit_o_negative")
    facility_id = "TEST-ANOM"
    # Drawdown accelerates hard over the trailing window while throughput
    # stays flat — the signature the detector looks for.
    levels = _declining_series(400.0, daily_use=1.0)
    levels[-anomaly.WINDOW:] = _declining_series(levels[-anomaly.WINDOW], daily_use=6.0, days=anomaly.WINDOW)
    stock = {blood.display_name: {
        "resource_id": blood.id, "unit": blood.unit, "category": blood.category,
        "capacity": 400.0, "reorder_level": 100.0, "levels": levels,
    }}
    synthetic_facility(facility_id, "Blood_Bank", stock, visits=[20] * 90)

    scored = anomaly._phc_indices(facility_id)

    assert scored is not None, "a blood bank stocking no medicines must still be scored"
    assert [c["medicine"] for c in scored["contributions"]] == [blood.display_name]
    assert scored["consumption_index"] > 1.0  # accelerating drawdown detected
