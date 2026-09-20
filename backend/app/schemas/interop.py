"""Versioned public interoperability schemas — the OpenLMIS mechanism: a
published, neutral shape for the two core objects a logistics system needs
to exchange (a stockout alert, a redistribution transfer request), so an
existing state system (e-Aushadhi, eVIN, a hospital's own ERP) could
integrate with SetuHealth's data without adopting the platform wholesale.

These are a formalization pass over shapes SetuHealth already produces
internally — StockoutAlertV1 mirrors ``forecasting.network_alerts()``'s
dicts (also ``lib/types.ts``'s ``Forecast``), and TransferRequestV1 mirrors
``redistribution.recommend_all()``'s dicts (``lib/types.ts``'s
``RedistributionRec``). Every field is populated from real, live in-memory
state — see ``app/routers/export.py``.

Versioning: a schema is named ``...V1``. A backward-incompatible change to a
field a real integrator might already depend on ships as a new ``...V2``
class (and a new endpoint, e.g. ``/api/export/v2/alerts.json``) rather than
silently changing what V1 means.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

RiskLevel = Literal["low", "warning", "critical"]


class StockoutAlertV1(BaseModel):
    """One facility/resource pair currently at elevated stockout risk.

    A stockout alert exists for every (facility, resource) combination at
    "warning" or "critical" risk as of ``generated_at`` — there is no
    separate "resolved" event; an alert simply stops appearing in the next
    export once risk drops back to "low"."""

    schema_version: Literal["1.0"] = "1.0"
    alert_id: str = Field(
        description="Stable id for this (facility, resource) pair: '<facility_id>:<resource_id>'. "
        "Re-appears with the same id across exports as long as the alert is still open."
    )
    facility_id: str = Field(description="SetuHealth's internal facility id, e.g. 'PHC-0001' or 'BLD-0002'.")
    facility_name: str
    facility_type: str = Field(
        description="One of the network's registered facility types (e.g. 'PHC', 'Blood_Bank', "
        "'District_Hospital') — see FacilityType in app/data/resource_types.py."
    )
    state: str
    district: str
    resource_id: str = Field(
        description="Stable resource slug (e.g. 'paracetamol_500mg', 'blood_unit_o_negative') — "
        "see ResourceType.id in app/data/resource_types.py."
    )
    resource_name: str = Field(description="Human-readable resource name, e.g. 'Paracetamol 500mg'.")
    resource_category: str = Field(description="e.g. 'antibiotic', 'blood products', 'respiratory'.")
    unit: str = Field(description="Unit the quantities below are denominated in, e.g. 'strip', 'vial', 'unit'.")
    current_level: float
    reorder_level: float = Field(description="The safety threshold: risk is measured against breaching this level.")
    capacity: float = Field(description="Full stocked capacity for this resource at this facility.")
    days_to_stockout: float | None = Field(
        default=None,
        description="Forecast days until the reorder threshold is breached. Null if the forecast "
        "horizon (14 days) ends before a breach is projected.",
    )
    risk_level: RiskLevel = Field(description="Always 'warning' or 'critical' in this export — 'low'-risk pairs are not alerts.")
    daily_depletion_rate: float = Field(description="Forecasted mean daily consumption over the forecast horizon, in `unit`.")
    forecast_method: Literal["exponential_smoothing", "fallback"] = Field(
        description="'exponential_smoothing' = Holt's linear trend model; 'fallback' = trailing "
        "moving average, used when there isn't enough history to fit a trend model."
    )
    generated_at: datetime = Field(description="When this alert was computed (UTC).")


class TransferRequestV1(BaseModel):
    """A system-recommended redistribution transfer: move `quantity` `unit`
    of `resource_id` from the origin facility to the destination facility.

    This is a RECOMMENDATION from the redistribution optimizer
    (app/services/redistribution.py), not a record of something that already
    happened — see `status`. An already-executed transfer is a different,
    existing object with its own export: GET /api/fhir/transfer/{id} (a FHIR
    R4 SupplyRequest). A future V2 of this schema could unify the two; V1
    deliberately doesn't, to avoid overloading "transfer request" with two
    meanings on day one.
    """

    schema_version: Literal["1.0"] = "1.0"
    request_id: str = Field(
        description="Stable id for this recommendation: "
        "'<origin_facility_id>:<destination_facility_id>:<resource_id>'."
    )
    status: Literal["recommended"] = Field(
        default="recommended",
        description="Always 'recommended' today — this export only contains open optimizer output.",
    )
    resource_id: str
    resource_name: str
    unit: str
    quantity: float
    origin_facility_id: str
    origin_facility_name: str
    origin_state: str
    origin_district: str
    destination_facility_id: str
    destination_facility_name: str
    destination_state: str
    destination_district: str
    distance_km: float
    cross_state: bool
    urgency: RiskLevel = Field(description="Risk level at the destination facility that this transfer would relieve.")
    generated_at: datetime = Field(description="When this recommendation was computed (UTC).")
