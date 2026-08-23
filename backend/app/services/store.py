"""In-memory data store loaded from the generated synthetic dataset.
Acts as the single source of truth the routers/services read from.
Allows dynamic mutations (crises, transfers) with optional disk persistence.
"""
import json
from pathlib import Path

from app.data.generate_data import build, OUT_DIR

_REQUIRED = [
    "dates.json",
    "phcs.json",
    "stock_history.json",
    "bed_history.json",
    "staff_history.json",
    "medicines.json",
]


def _ensure_data():
    if not all((OUT_DIR / f).exists() for f in _REQUIRED):
        build()


def _load(name: str):
    return json.loads((OUT_DIR / name).read_text())


_ensure_data()

DATES: list[str] = _load("dates.json")
PHCS: list[dict] = _load("phcs.json")
STOCK_HISTORY: dict = _load("stock_history.json")
BED_HISTORY: dict = _load("bed_history.json")
STAFF_HISTORY: dict = _load("staff_history.json")
MEDICINES: list[dict] = _load("medicines.json")

PHC_BY_ID = {p["id"]: p for p in PHCS}
ACTIVE_CRISES: list[dict] = []


def phcs_in_state(state: str | None = None, district: str | None = None):
    out = PHCS
    if state:
        out = [p for p in out if p["state"] == state]
    if district:
        out = [p for p in out if p["district"] == district]
    return out


def states():
    seen = {}
    for p in PHCS:
        seen.setdefault(p["state"], set()).add(p["district"])
    return {s: sorted(d) for s, d in seen.items()}


def save_stock_history():
    """Write the current in-memory stock levels back to the JSON file to persist state."""
    (OUT_DIR / "stock_history.json").write_text(json.dumps(STOCK_HISTORY))


def save_bed_history():
    """Write the current in-memory bed occupancy back to the JSON file to persist state."""
    (OUT_DIR / "bed_history.json").write_text(json.dumps(BED_HISTORY))


def reset_store_data():
    """Reset all in-memory histories and crisis lists back to the baseline synthetic data."""
    global DATES, PHCS, STOCK_HISTORY, BED_HISTORY, STAFF_HISTORY, MEDICINES, PHC_BY_ID, ACTIVE_CRISES
    # Re-run builder to get fresh deterministic baseline files
    build()
    DATES = _load("dates.json")
    PHCS = _load("phcs.json")
    STOCK_HISTORY = _load("stock_history.json")
    BED_HISTORY = _load("bed_history.json")
    STAFF_HISTORY = _load("staff_history.json")
    MEDICINES = _load("medicines.json")
    PHC_BY_ID = {p["id"]: p for p in PHCS}
    ACTIVE_CRISES = []

    # Clean transfers list if transfers.json exists
    transfers_file = OUT_DIR / "transfers.json"
    if transfers_file.exists():
        try:
            transfers_file.unlink()
        except Exception:
            pass


def trigger_crisis(target_type: str, target_name: str, crisis_type: str):
    """Mutate stock levels and bed histories for target facilities to simulate a health crisis/outbreak."""
    # Record active crisis
    ACTIVE_CRISES.append(
        {"target_type": target_type, "target_name": target_name, "crisis_type": crisis_type}
    )

    # Determine target PHCs
    target_ids = []
    for p in PHCS:
        if target_type == "state" and p["state"] == target_name:
            target_ids.append(p["id"])
        elif target_type == "district" and p["district"] == target_name:
            target_ids.append(p["id"])
        elif target_type == "all":
            target_ids.append(p["id"])

    # Mutate inventories and beds
    for pid in target_ids:
        # Bed occupancy surge
        if crisis_type in ("Dengue Outbreak", "Monsoon Floods"):
            total_beds = PHC_BY_ID[pid]["beds_total"]
            # Modify last 14 days of bed occupancy to look highly occupied
            current_occ = BED_HISTORY[pid]["occupied"]
            n_days = len(current_occ)
            for idx in range(max(0, n_days - 14), n_days):
                current_occ[idx] = min(total_beds, max(round(total_beds * 0.9), current_occ[idx]))
            current_occ[-1] = total_beds  # set to 100% capacity today

        # Medicine depletion list
        deplete_meds = []
        if crisis_type == "Dengue Outbreak":
            deplete_meds = ["Paracetamol 500mg", "ORS Sachets"]
        elif crisis_type == "Malaria Outbreak":
            deplete_meds = ["Artesunate Injection", "Cotrimoxazole Syrup"]
        elif crisis_type == "Monsoon Floods":
            deplete_meds = ["ORS Sachets", "Paracetamol 500mg", "Amoxicillin 500mg"]

        for med in deplete_meds:
            if med in STOCK_HISTORY[pid]:
                rec = STOCK_HISTORY[pid][med]
                levels = rec["levels"]
                n_days = len(levels)
                crash_start_idx = max(0, n_days - 14)
                # Start the depletion from the maximum capacity to simulate high active consumption
                start_val = rec["capacity"]

                # Dynamically calculate pre-crisis depletion rate to scale the surge
                from app.services.forecasting import check_surge
                _, recent_rate, _ = check_surge(levels)
                surge_rate = max(1.5, recent_rate) * 4.0

                # Crash stock levels progressively over the trailing 14-day window to simulate a real surge
                for idx in range(crash_start_idx, n_days):
                    days_since_start = idx - crash_start_idx + 1
                    levels[idx] = round(max(0.0, start_val - days_since_start * surge_rate), 1)

    # Save to disk to make the crisis effects survive restarts
    save_stock_history()
    save_bed_history()
