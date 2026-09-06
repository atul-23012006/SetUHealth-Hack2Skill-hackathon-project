import uuid
from datetime import datetime

from app.services import db, store


def load_transfers() -> list[dict]:
    """Load all transfer manifests from the SQLite ledger (newest first)."""
    return db.list_transfers()


def create_and_execute_transfer(
    from_phc_id: str, to_phc_id: str, medicine: str, quantity: float
) -> dict:
    """Execute a stock redistribution transfer by modifying store levels and logging the manifest."""
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
    }

    # Persist the manifest to the SQLite ledger (also writes an audit-log row)
    db.record_transfer(manifest)

    # Clear in-memory forecast cache
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()

    return manifest
