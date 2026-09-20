"""Autonomous dispatch — the Zipline mechanism's execution half.

``redistribution.py`` already tells an officer *what* to move and *where*;
until now, a human had to read that recommendation and click Execute for
anything to actually happen. This module is the extension point for closing
that loop for routine, low-risk transfers: an interface any logistics
integration would implement, plus exactly one concrete implementation that
makes "auto-dispatch" real, working code today — not a mocked-up promise.

``SimulatedGroundCourierProvider`` is the only concrete provider. It is
labelled as simulated everywhere it surfaces (the SQLite audit log via
``db.log_event``, the ``DispatchResult.simulated`` field, and the
``auto_dispatched``/``dispatch`` fields on the transfer manifest the officer
console renders — see ``Transfers.tsx``'s badge). A real provider — an
adapter for India's ONDC logistics network, or a drone-logistics API for
cold-chain-critical resources reaching a facility no road can reach quickly
— would implement ``LogisticsProvider`` the same way and could be swapped
in via ``services/transfers.py``'s call site without any caller changing.
That substitutability is the actual point of defining the interface now,
not a claim that such a provider exists.

``dispatch()`` takes a ``TransferRequestV1`` — the same versioned schema
Phase 4's ``/api/export/transfers.json`` publishes externally — so a real
provider integration and this demo's simulated one are handed identically
shaped data; nothing about the interface would need to change to plug in
a real logistics API tomorrow.
"""
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone

from app.schemas.interop import TransferRequestV1
from app.services import db

# Rough rural/semi-urban Indian road-transport average. SYNTHETIC — not
# sourced from any logistics dataset, chosen only to produce a plausible ETA
# for a simulated demo. A real ground-courier integration would replace this
# entire calculation with the provider's own routing/ETA API response.
AVERAGE_GROUND_COURIER_SPEED_KMH = 35.0


@dataclass(frozen=True)
class DispatchResult:
    """What a LogisticsProvider hands back once it accepts a dispatch."""

    dispatch_id: str
    provider: str
    simulated: bool
    eta_minutes: float
    dispatched_at: str  # ISO 8601, UTC


class LogisticsProvider(ABC):
    """The seam a real logistics integration implements. Every provider —
    simulated or real — takes the same published TransferRequestV1 and
    returns a DispatchResult; nothing about pricing, courier assignment, or
    tracking protocol needs to leak into whatever calls dispatch()."""

    @abstractmethod
    def dispatch(self, transfer: TransferRequestV1) -> DispatchResult:
        ...


class SimulatedGroundCourierProvider(LogisticsProvider):
    """Computes a fabricated-but-labelled ETA from the transfer's own
    ``distance_km`` (the same haversine distance redistribution.py already
    computes for every recommendation) at a fixed assumed road speed, and
    logs the dispatch to the existing SQLite ledger via ``db.log_event`` —
    the same audit trail every other state mutation in this system writes
    to, so a dispatch shows up in GET /api/audit and the Transfers page's
    audit-trail panel exactly like a transfer or a crisis trigger."""

    provider_name = "simulated_ground_courier"

    def dispatch(self, transfer: TransferRequestV1) -> DispatchResult:
        eta_minutes = round((transfer.distance_km / AVERAGE_GROUND_COURIER_SPEED_KMH) * 60, 1)
        dispatch_id = f"DISP-{uuid.uuid4().hex[:8].upper()}"
        dispatched_at = datetime.now(timezone.utc).isoformat()

        db.log_event(
            "dispatch",
            f"[SIMULATED] {transfer.quantity} {transfer.unit} of {transfer.resource_name} "
            f"dispatched via ground courier: {transfer.origin_facility_name} -> "
            f"{transfer.destination_facility_name} ({transfer.distance_km} km, ETA {eta_minutes} min)",
            {
                "dispatch_id": dispatch_id,
                "request_id": transfer.request_id,
                "provider": self.provider_name,
                "simulated": True,
                "distance_km": transfer.distance_km,
                "eta_minutes": eta_minutes,
            },
        )

        return DispatchResult(
            dispatch_id=dispatch_id,
            provider=self.provider_name,
            simulated=True,
            eta_minutes=eta_minutes,
            dispatched_at=dispatched_at,
        )
