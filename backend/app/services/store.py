"""In-memory data store loaded from the generated synthetic dataset.
Acts as the single source of truth the routers/services read from.
Allows dynamic mutations (crises, transfers) with optional disk persistence.

Durability: the histories are still mirrored to JSON on mutation for fast
reload, but the transactional ledger (transfers, crisis log, audit trail)
lives in SQLite via ``services/db.py`` — so an active crisis and its audit
history survive a backend restart.
"""
import json

from app.data.generate_data import build, OUT_DIR
from app.services import db

_REQUIRED = [
    "dates.json",
    "phcs.json",
    "stock_history.json",
    "bed_history.json",
    "staff_history.json",
    "footfall_history.json",
    "medicines.json",
]


def _ensure_data():
    if not all((OUT_DIR / f).exists() for f in _REQUIRED):
        build()
    db.init_db()


def _load(name: str):
    return json.loads((OUT_DIR / name).read_text())


_ensure_data()

def _load_optional(name: str, default):
    path = OUT_DIR / name
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


DATES: list[str] = _load("dates.json")
PHCS: list[dict] = _load("phcs.json")
STOCK_HISTORY: dict = _load("stock_history.json")
BED_HISTORY: dict = _load("bed_history.json")
STAFF_HISTORY: dict = _load("staff_history.json")
FOOTFALL_HISTORY: dict = _load_optional("footfall_history.json", {})
# Ground-truth labels for the injected demo anomalies. The detector does not
# read these; they are kept only so a demo can confirm what it caught.
ANOMALY_FLAGS: dict = _load_optional("anomaly_flags.json", {})
MEDICINES: list[dict] = _load("medicines.json")

PHC_BY_ID = {p["id"]: p for p in PHCS}
# Rehydrated from the SQLite crisis log so the dashboard banner and the
# elevated forecasts stay consistent across a backend restart.
ACTIVE_CRISES: list[dict] = db.list_active_crises()

COLD_CHAIN_TEMPS: dict[str, float] = {}
COLD_CHAIN_FAILURES: set[str] = set()

def get_facility_temp(phc_id: str) -> float:
    if phc_id in COLD_CHAIN_FAILURES:
        return COLD_CHAIN_TEMPS.get(phc_id, 12.4)
    if phc_id not in COLD_CHAIN_TEMPS:
        import random
        # Seeded Random using phc_id to keep values stable across page updates
        r = random.Random(phc_id)
        # Introduce a few baseline temperature anomalies at startup (5% chance)
        if r.random() < 0.05:
            COLD_CHAIN_TEMPS[phc_id] = round(r.uniform(9.0, 13.0), 1)
        else:
            COLD_CHAIN_TEMPS[phc_id] = round(r.uniform(2.5, 5.5), 1)
    return COLD_CHAIN_TEMPS[phc_id]

def trigger_cold_chain_failure(phc_id: str):
    COLD_CHAIN_FAILURES.add(phc_id)
    COLD_CHAIN_TEMPS[phc_id] = 12.4
    # Clear in-memory forecast cache so updates propagate immediately
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()


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


def save_footfall_history():
    """Write the current in-memory OPD footfall back to the JSON file to persist state."""
    (OUT_DIR / "footfall_history.json").write_text(json.dumps(FOOTFALL_HISTORY))


def reset_store_data():
    """Reset all in-memory histories and crisis lists back to the baseline synthetic data."""
    global DATES, PHCS, STOCK_HISTORY, BED_HISTORY, STAFF_HISTORY, FOOTFALL_HISTORY, ANOMALY_FLAGS, MEDICINES, PHC_BY_ID, ACTIVE_CRISES, COLD_CHAIN_TEMPS, COLD_CHAIN_FAILURES
    # Re-run builder to get fresh deterministic baseline files
    build()
    DATES = _load("dates.json")
    PHCS = _load("phcs.json")
    STOCK_HISTORY = _load("stock_history.json")
    BED_HISTORY = _load("bed_history.json")
    STAFF_HISTORY = _load("staff_history.json")
    FOOTFALL_HISTORY = _load_optional("footfall_history.json", {})
    ANOMALY_FLAGS = _load_optional("anomaly_flags.json", {})
    MEDICINES = _load("medicines.json")
    PHC_BY_ID = {p["id"]: p for p in PHCS}
    ACTIVE_CRISES = []
    COLD_CHAIN_TEMPS = {}
    COLD_CHAIN_FAILURES = set()

    # Wipe the SQLite ledger (transfers, crisis log, audit trail) back to empty
    db.reset_all()

    # Clean transfers list if transfers.json exists
    transfers_file = OUT_DIR / "transfers.json"
    if transfers_file.exists():
        try:
            transfers_file.unlink()
        except Exception:
            pass

    # Clear in-memory forecast cache
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()


def trigger_crisis(target_type: str, target_name: str, crisis_type: str):
    """Mutate stock levels and bed histories for target facilities to simulate a health crisis/outbreak."""
    # Record active crisis — in memory for this process and in SQLite so it
    # (and the dashboard banner) survives a backend restart.
    rec = {"target_type": target_type, "target_name": target_name, "crisis_type": crisis_type}
    ACTIVE_CRISES.append(rec)
    db.record_crisis(rec)

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
        if crisis_type == "Cold Chain Failure":
            trigger_cold_chain_failure(pid)
            continue

        # Bed occupancy surge
        if crisis_type in ("Dengue Outbreak", "Monsoon Floods"):
            total_beds = PHC_BY_ID[pid]["beds_total"]
            # Modify last 14 days of bed occupancy to look highly occupied
            current_occ = BED_HISTORY[pid]["occupied"]
            n_days = len(current_occ)
            for idx in range(max(0, n_days - 14), n_days):
                current_occ[idx] = min(total_beds, max(round(total_beds * 0.9), current_occ[idx]))
            current_occ[-1] = total_beds  # set to 100% capacity today

        # OPD footfall surge — keeps patient volume consistent with the extra
        # medicine consumption below, so the anomaly detector doesn't mistake a
        # genuine outbreak at a crisis PHC for pilferage.
        if crisis_type in ("Dengue Outbreak", "Malaria Outbreak", "Monsoon Floods") and pid in FOOTFALL_HISTORY:
            visits = FOOTFALL_HISTORY[pid]["visits"]
            n_days = len(visits)
            for idx in range(max(0, n_days - 14), n_days):
                visits[idx] = round(visits[idx] * 1.8)

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
    save_footfall_history()

    # Clear in-memory forecast cache
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()
