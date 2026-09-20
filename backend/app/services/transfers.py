import uuid
from datetime import datetime, timezone

from app.schemas.interop import TransferRequestV1
from app.services import db, geo, store
from app.services.dispatch import SimulatedGroundCourierProvider

# Auto-dispatch eligibility — deliberately conservative. Per the plan's own
# framing this is for "routine, low-risk transfers" only: large, cross-state,
# or destination-critical transfers always fall back to requiring a human to
# click Execute with no dispatch attached, exactly as every transfer worked
# before this module existed.
AUTO_DISPATCH_MAX_QUANTITY = 50.0
AUTO_DISPATCH_EXCLUDED_RISK = {"critical"}


def load_transfers() -> list[dict]:
    """Load all transfer manifests from the SQLite ledger (newest first)."""
    return db.list_transfers()


def _auto_dispatch_eligibility(from_phc: dict, to_phc: dict, quantity: float, risk: str) -> str | None:
    """None if eligible for auto-dispatch; otherwise the reason it isn't.
    Kept as one explicit, readable gate rather than three scattered ifs, so
    the actual threshold is easy to audit in one place."""
    if from_phc["state"] != to_phc["state"]:
        return "cross-state transfers require manual sign-off"
    if quantity > AUTO_DISPATCH_MAX_QUANTITY:
        return f"quantity exceeds the auto-dispatch threshold ({AUTO_DISPATCH_MAX_QUANTITY})"
    if risk in AUTO_DISPATCH_EXCLUDED_RISK:
        return "destination facility is at critical risk — requires manual sign-off"
    return None


def create_and_execute_transfer(
    from_phc_id: str, to_phc_id: str, medicine: str, quantity: float,
    requested_by: str | None = None, auto_execute: bool = False,
) -> dict:
    """Execute a stock redistribution transfer by modifying store levels and logging the manifest.

    Execution itself (the stock mutation and ledger entry) always happens
    synchronously, exactly as it did before Phase 5 — that part of this
    system never had a "pending approval" state to begin with.
    ``auto_execute`` controls something new and additional: whether the
    system also attempts to dispatch a courier inline, via
    ``dispatch.SimulatedGroundCourierProvider``, instead of the transfer
    simply completing with no physical-logistics step at all. Ineligible
    transfers (see ``_auto_dispatch_eligibility``) behave exactly as before,
    whether or not ``auto_execute`` was requested.
    """
    from_phc = store.PHC_BY_ID.get(from_phc_id)
    to_phc = store.PHC_BY_ID.get(to_phc_id)

    if not from_phc or not to_phc:
        raise ValueError("Invalid sender or recipient PHC ID")

    if medicine not in store.STOCK_HISTORY[from_phc_id]:
        raise ValueError(f"Medicine {medicine} not found at donor PHC")
    if medicine not in store.STOCK_HISTORY[to_phc_id]:
        raise ValueError(f"Medicine {medicine} not found at recipient PHC")

    # Access stock records
    donor_stock = store.STOCK_HISTORY[from_phc_id][medicine]
    recipient_stock = store.STOCK_HISTORY[to_phc_id][medicine]

    # Mutate current levels (the last element of levels timeline)
    donor_stock["levels"][-1] = round(max(0.0, donor_stock["levels"][-1] - quantity), 1)
    recipient_stock["levels"][-1] = round(recipient_stock["levels"][-1] + quantity, 1)

    # Persist stock history updates
    store.save_stock_history()

    # Generate transfer manifest
    manifest = {
        "id": f"TR-{uuid.uuid4().hex[:6].upper()}",
        "medicine": medicine,
        "unit": donor_stock["unit"],
        "from_phc_id": from_phc_id,
        "from_phc_name": from_phc["name"],
        "from_state": from_phc["state"],
        "from_district": from_phc["district"],
        "to_phc_id": to_phc_id,
        "to_phc_name": to_phc["name"],
        "to_state": to_phc["state"],
        "to_district": to_phc["district"],
        "quantity": quantity,
        "status": "Completed",
        "created_at": datetime.now().isoformat(),
        "requested_by": requested_by,
        "auto_dispatched": False,
        "dispatch": None,
        "auto_dispatch_declined_reason": None,
    }

    if auto_execute:
        from app.services.forecasting import forecast_medicine
        risk = forecast_medicine(to_phc_id, medicine)["risk"]
        declined_reason = _auto_dispatch_eligibility(from_phc, to_phc, quantity, risk)

        if declined_reason is None:
            resource = store.resource_type(medicine)
            request = TransferRequestV1(
                request_id=f"{from_phc_id}:{to_phc_id}:{resource.id if resource else medicine}",
                resource_id=resource.id if resource else medicine,
                resource_name=medicine,
                unit=donor_stock["unit"],
                quantity=quantity,
                origin_facility_id=from_phc_id,
                origin_facility_name=from_phc["name"],
                origin_state=from_phc["state"],
                origin_district=from_phc["district"],
                destination_facility_id=to_phc_id,
                destination_facility_name=to_phc["name"],
                destination_state=to_phc["state"],
                destination_district=to_phc["district"],
                distance_km=round(geo.haversine_km(from_phc, to_phc), 1),
                cross_state=False,  # eligibility already requires same-state
                urgency=risk,
                generated_at=datetime.now(timezone.utc),
            )
            result = SimulatedGroundCourierProvider().dispatch(request)
            manifest["auto_dispatched"] = True
            manifest["dispatch"] = {
                "dispatch_id": result.dispatch_id,
                "provider": result.provider,
                "simulated": result.simulated,
                "eta_minutes": result.eta_minutes,
                "dispatched_at": result.dispatched_at,
            }
        else:
            manifest["auto_dispatch_declined_reason"] = declined_reason

    # Persist the manifest to the SQLite ledger (also writes an audit-log row)
    db.record_transfer(manifest)

    # Clear in-memory forecast cache
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()

    return manifest
