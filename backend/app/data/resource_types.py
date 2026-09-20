"""Generic resource- and facility-type registry.

Nothing in forecasting, anomaly detection or redistribution knows what a
"medicine" is. Those engines operate on *resource types*: a named thing a
facility holds a stock level of, which draws down over time and can be moved
to another facility. This module is the single place that defines what those
things are, and which kinds of facility hold them.

**To track a new resource** (a vaccine, a ventilator consumable, a diagnostic
kit), append one ``ResourceType`` to ``_EXTRA_RESOURCE_TYPES`` below. Nothing
else needs to change: the synthetic generator starts producing a stock series
for it at every facility type listed in its ``facility_types``, and
forecasting, anomaly detection, redistribution and the federated aggregation
all pick it up automatically.

**Identity:** ``ResourceType.id`` is a stable machine slug (``paracetamol_500mg``,
``blood_unit_o_negative``). ``display_name`` is both the human label *and* the
key used in ``store.STOCK_HISTORY`` and in existing API payloads' ``medicine``
field — so the twelve NLEM medicines keep exactly the keys and labels they
have always had, while new resources render as readable names in the officer
console with no frontend change. ``get()`` resolves either form.

**Data provenance (per Guardrail 2 — never present synthetic figures as real):**
the twelve medicines' consumption anchors are real, sourced and cited in
``reference.REAL_CONSUMPTION_ANCHORS``. The two non-medicine resource types
below carry ``source=None``: their demand figures are SYNTHETIC, chosen to be
plausible, and are labelled as such wherever they surface.
"""
import re
from dataclasses import dataclass

from app.data.reference import MEDICINES, REAL_CONSUMPTION_ANCHORS

# Medicines requiring 2-8°C storage. This list used to be hardcoded inside
# forecasting.py; it lives here now so cold-chain monitoring is a property of
# the resource, not a branch in the engine.
_COLD_CHAIN_MEDICINES = {"Insulin (Human)", "Oxytocin Injection"}

# Procurement/replenishment lead time for NLEM medicines at PHC level, in days.
_MEDICINE_REORDER_LEAD_TIME_DAYS = 7


@dataclass(frozen=True)
class ResourceType:
    """A scarce, trackable, transferable resource held at a facility."""

    id: str
    # Also the key used in store.STOCK_HISTORY and in the `medicine` field of
    # existing API responses — see the module docstring on identity.
    display_name: str
    unit: str
    category: str
    # Drives cold-chain temperature monitoring in forecasting.py: a perishable
    # resource is temperature-tracked and evacuated first when its chain fails.
    is_perishable: bool
    # Declarative replenishment lead time, published to integrators (and used
    # by the Phase 4 interop schema). The forecast risk thresholds are
    # horizon-based (see forecasting.CRITICAL_DAYS/WARNING_DAYS), not
    # lead-time-based, so changing this does not silently reclassify risk.
    reorder_lead_time_days: int
    # 1 = critical (a stockout costs lives), 2 = essential, 3 = supportive.
    # Weights how hard redistribution works to close a shortfall.
    tier: int = 3
    # Season whose demand multiplier applies in the synthetic generator.
    seasonal: str | None = None
    daily_use_mean: float = 5.0
    daily_use_std: float = 1.5
    # Which facility types stock this resource. The generator reads this to
    # decide where to produce a stock series.
    facility_types: tuple[str, ...] = ("PHC",)
    # Citation for the consumption anchor, or None when the figures are
    # synthetic. Never leave this filled in unless a real source backs it.
    source: str | None = None


@dataclass(frozen=True)
class FacilityType:
    """A kind of facility in the network. ``capacity_dimensions`` names the
    non-stock capacities it reports (beds, staff rosters, storage), which is
    what makes "capacity redistribution" meaningful per facility type."""

    id: str
    display_name: str
    capacity_dimensions: tuple[str, ...]


FACILITY_TYPES: list[FacilityType] = [
    FacilityType("PHC", "Primary Health Centre", ("beds", "staff")),
    FacilityType("Blood_Bank", "Blood Bank", ("blood_storage_units", "staff")),
    FacilityType("District_Hospital", "District Hospital", ("beds", "staff", "oxygen_manifold")),
]


def _slug(name: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", name.lower())).strip("_")


def _medicine_resource_types() -> list[ResourceType]:
    """Lift the twelve NLEM medicines in reference.py into the generic
    registry. They keep their clinical metadata (tier, seasonality) and their
    real, cited consumption anchors — this is a projection of existing data
    into the generic model, not a second copy of it."""
    out = []
    for m in MEDICINES:
        anchor = REAL_CONSUMPTION_ANCHORS.get(m["name"], {})
        out.append(
            ResourceType(
                id=_slug(m["name"]),
                display_name=m["name"],
                unit=m["unit"],
                category=m["category"],
                is_perishable=m["name"] in _COLD_CHAIN_MEDICINES,
                reorder_lead_time_days=_MEDICINE_REORDER_LEAD_TIME_DAYS,
                tier=m.get("tier", 3),
                seasonal=m.get("seasonal"),
                daily_use_mean=anchor.get("mean", 5.0),
                daily_use_std=anchor.get("std", 1.5),
                facility_types=("PHC",),
                source=anchor.get("source"),
            )
        )
    return out


# Non-medicine resources, here to prove the model is not medicine-only. Their
# demand figures are SYNTHETIC (source=None) — plausible, not sourced.
_EXTRA_RESOURCE_TYPES: list[ResourceType] = [
    ResourceType(
        id="oxygen_cylinder_d_type",
        display_name="Oxygen Cylinder (D-type)",
        unit="cylinder",
        category="respiratory",
        is_perishable=False,
        reorder_lead_time_days=3,
        tier=1,
        seasonal="winter",  # respiratory-illness season
        daily_use_mean=3.2,
        daily_use_std=1.1,
        facility_types=("District_Hospital",),
        source=None,
    ),
    ResourceType(
        id="blood_unit_o_negative",
        display_name="Blood Unit (O-negative)",
        unit="unit",
        category="blood products",
        # 35-42 day shelf life at 2-6°C — same cold-chain treatment as insulin.
        is_perishable=True,
        reorder_lead_time_days=1,
        tier=1,
        seasonal="monsoon",  # road-trauma season
        daily_use_mean=2.4,
        daily_use_std=1.0,
        facility_types=("Blood_Bank", "District_Hospital"),
        source=None,
    ),
]

RESOURCE_TYPES: list[ResourceType] = _medicine_resource_types() + _EXTRA_RESOURCE_TYPES

_BY_KEY: dict[str, ResourceType] = {}
for _rt in RESOURCE_TYPES:
    _BY_KEY[_rt.id] = _rt
    _BY_KEY[_rt.display_name] = _rt


def get(resource_key: str) -> ResourceType | None:
    """Look up a resource type by either its slug id or its display name
    (the latter being the key used in stock history and API payloads)."""
    return _BY_KEY.get(resource_key)


def stock_keys() -> list[str]:
    """Every resource's stock-history key, in registry order."""
    return [r.display_name for r in RESOURCE_TYPES]


def for_facility_type(facility_type_id: str) -> list[ResourceType]:
    return [r for r in RESOURCE_TYPES if facility_type_id in r.facility_types]


def categories() -> set[str]:
    return {r.category for r in RESOURCE_TYPES}


def facility_type(facility_type_id: str) -> FacilityType | None:
    return next((f for f in FACILITY_TYPES if f.id == facility_type_id), None)
