"""In-memory data store loaded from the generated synthetic dataset.
Acts as the single source of truth the routers/services read from.
Allows dynamic mutations (crises, transfers) with optional disk persistence.

Durability: the histories are still mirrored to JSON on mutation for fast
reload, but the transactional ledger (transfers, crisis log, audit trail)
lives in SQLite via ``services/db.py`` — so an active crisis and its audit
history survive a backend restart.

Generic resource model: ``PHCS`` is the *facility* roster and may contain
facility types other than PHCs (each record carries ``facility_type``); use
``facilities()`` to filter. ``STOCK_HISTORY`` is keyed by resource, not
specifically by medicine — what those resources are is defined in
``app/data/resource_types.py``, re-exported here so services have one place
to read from. ``MEDICINES`` remains medicine-only, since it backs the
medicine-specific clinical UI (tiers, NLEM metadata).
"""
import json
from datetime import UTC, datetime
from typing import TypedDict

from app.data import resource_types
from app.data.generate_data import OUT_DIR, build
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


def phcs_in_state(state: str | None = None, district: str | None = None,
                  facility_type: str | None = None):
    """Filter the facility roster. ``facility_type=None`` means every type —
    callers that specifically want PHCs (the officer console's map and
    facility list) pass ``facility_type="PHC"``."""
    out = PHCS
    if state:
        out = [p for p in out if p["state"] == state]
    if district:
        out = [p for p in out if p["district"] == district]
    if facility_type:
        out = [p for p in out if p.get("facility_type", "PHC") == facility_type]
    return out


def resource_type(resource_key: str):
    """Resource metadata by stock-history key or slug id. See
    app/data/resource_types.py — this is the only place the engines learn
    anything about what a resource *is*."""
    return resource_types.get(resource_key)


def resource_stock_keys() -> list[str]:
    """Every tracked resource's stock-history key, in registry order."""
    return resource_types.stock_keys()


def resource_categories() -> set[str]:
    return resource_types.categories()


def states():
    seen: dict[str, set[str]] = {}
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
    CRISIS_IMPACTS.clear()
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


# Medicines each simulated crisis drains. Cold Chain Failure moves no stock:
# it breaks refrigeration, which flags every perishable item at the facility.
CRISIS_DEPLETION: dict[str, list[str]] = {
    "Dengue Outbreak": ["Paracetamol 500mg", "ORS Sachets"],
    "Malaria Outbreak": ["Artesunate Injection", "Cotrimoxazole Syrup"],
    "Monsoon Floods": ["ORS Sachets", "Paracetamol 500mg", "Amoxicillin 500mg"],
    "Cold Chain Failure": [],
}
BED_SURGE_CRISES = {"Dengue Outbreak", "Monsoon Floods"}
FOOTFALL_SURGE_CRISES = {"Dengue Outbreak", "Malaria Outbreak", "Monsoon Floods"}

class CrisisSeverityRule(TypedDict):
    """Planning assumptions for a *typical* (intensity = 1.0) instance of a
    crisis type, in the same spirit as weather_impact.py's RULES table: named,
    capped multipliers with a stated reason, not a claim of measured fact."""
    stock_fraction: float  # share of a facility's *current* stock consumed over the
    # 14-day window. Never 1.0 — a real depletion curve rarely reaches exactly
    # zero, dispensing doesn't perfectly track to the last unit.
    bed_fraction: float  # how far occupancy closes the gap to full capacity.
    footfall_multiplier: float  # OPD visit surge, same shape as weather_impact's
    # RULES multipliers (only the excess over 1.0 scales with intensity).
    why: str


CRISIS_SEVERITY: dict[str, CrisisSeverityRule] = {
    "Dengue Outbreak": {"stock_fraction": 0.70, "bed_fraction": 0.55, "footfall_multiplier": 1.8,
                         "why": "A dengue surge concentrates demand on fever/fluid replacement stock and beds over 1-2 weeks."},
    "Malaria Outbreak": {"stock_fraction": 0.65, "bed_fraction": 0.0, "footfall_multiplier": 1.6,
                          "why": "Malaria is largely managed as outpatient care; antimalarials deplete fast but bed demand rises less."},
    "Monsoon Floods": {"stock_fraction": 0.80, "bed_fraction": 0.60, "footfall_multiplier": 1.7,
                        "why": "Floods disrupt supply lines and access at the same time demand rises, compounding shortage risk."},
    "Cold Chain Failure": {"stock_fraction": 0.0, "bed_fraction": 0.0, "footfall_multiplier": 1.0,
                            "why": "A refrigeration failure spoils perishable stock in place; it does not change consumption."},
}
# Per-facility variance around the target, so a state-wide crisis doesn't
# drain every PHC to an identical, visibly-scripted number.
CRISIS_VARIANCE = 0.25  # +/- 25%
INTENSITY_MIN, INTENSITY_MAX = 0.25, 2.0

# Cap on per-row changes returned for one crisis; the totals always cover all of them.
IMPACT_ROW_LIMIT = 300

# Before/after record of what each simulated crisis changed, newest last.
# In memory only: it explains the current session's simulations and is cleared
# by reset_store_data(). The mutated data itself is persisted as usual.
CRISIS_IMPACTS: list[dict] = []


def crisis_targets(target_type: str, target_name: str) -> list[str]:
    """Facility ids a crisis aimed at a state / district / "all" applies to."""
    if target_type == "all":
        return [p["id"] for p in PHCS]
    key = {"state": "state", "district": "district"}.get(target_type)
    if key is None:
        return []
    return [p["id"] for p in PHCS if p[key] == target_name]


def _facility_variance(pid: str, crisis_type: str) -> float:
    """Deterministic +/-CRISIS_VARIANCE multiplier, seeded per (facility,
    crisis type) so a state-wide crisis hits facilities unevenly — like a
    real outbreak — while staying reproducible for tests and re-runs."""
    import random
    r = random.Random(f"crisis:{crisis_type}:{pid}")
    return 1.0 + r.uniform(-CRISIS_VARIANCE, CRISIS_VARIANCE)


def _scaled_fraction(base: float, intensity: float, variance: float, cap: float = 0.97) -> float:
    """Intensity scales the base target fraction directly (unlike the weather
    overlay's demand *multiplier*, a fraction-of-stock-consumed has no
    natural "1.0 = no effect" baseline to scale the excess of), then variance
    nudges it per facility. Always clamped short of total depletion — a real
    drawdown rarely reaches exactly zero."""
    return max(0.0, min(cap, base * intensity * variance))


def _rehydrate_cold_chain_failures() -> None:
    # Cold-chain failures live only in memory, but the crisis that caused them
    # is rehydrated from SQLite. Re-derive them so a restart doesn't show an
    # active "Cold Chain Failure" banner over normal temperatures.
    for c in ACTIVE_CRISES:
        if c["crisis_type"] == "Cold Chain Failure":
            for pid in crisis_targets(c["target_type"], c["target_name"]):
                COLD_CHAIN_FAILURES.add(pid)
                COLD_CHAIN_TEMPS[pid] = 12.4


_rehydrate_cold_chain_failures()


def _perishable_items(pid: str) -> list[str]:
    return [k for k in STOCK_HISTORY.get(pid, {})
            if (rt := resource_type(k)) is not None and rt.is_perishable]


def _crisis_snapshot(target_ids: list[str], crisis_type: str) -> dict:
    """The values a crisis is about to change, per facility, for a before/after diff."""
    from app.services.forecasting import forecast_medicine

    snap: dict[str, dict] = {}
    for pid in target_ids:
        entry: dict = {"stock": {}}
        items = _perishable_items(pid) if crisis_type == "Cold Chain Failure" else CRISIS_DEPLETION[crisis_type]
        for med in items:
            if med in STOCK_HISTORY.get(pid, {}):
                f = forecast_medicine(pid, med)
                entry["stock"][med] = {
                    "level": f["current_level"], "unit": f["unit"], "risk": f["risk"],
                    "days": f["days_to_stockout"], "cold_chain_alert": f["cold_chain_alert"],
                }
        if pid in BED_HISTORY:
            entry["beds"] = BED_HISTORY[pid]["occupied"][-1]
        if pid in FOOTFALL_HISTORY:
            entry["visits"] = FOOTFALL_HISTORY[pid]["visits"][-1]
        entry["temp"] = get_facility_temp(pid)
        snap[pid] = entry
    return snap


_RISK_RANK = {"low": 0, "warning": 1, "critical": 2}


def _crisis_impact(rec: dict, target_ids: list[str], before: dict, after: dict) -> dict:
    """Diff two snapshots into rows (one per changed value) plus headline totals."""
    cold_chain = rec["crisis_type"] == "Cold Chain Failure"
    rows: list[dict] = []
    totals = {
        "facilities_affected": len(target_ids),
        "stock_items_changed": 0, "stock_units_lost": 0.0,
        "newly_critical": 0, "risk_escalations": 0,
        "beds_newly_occupied": 0, "extra_opd_visits": 0,
        "cold_chain_alerts_raised": 0,
    }
    for pid in target_ids:
        b, a = before[pid], after[pid]
        phc = PHC_BY_ID[pid]
        base = {"phc_id": pid, "phc_name": phc["name"], "district": phc["district"], "state": phc["state"]}
        for med, sb in b["stock"].items():
            sa = a["stock"][med]
            risk_up = _RISK_RANK[sa["risk"]] > _RISK_RANK[sb["risk"]]
            if cold_chain:
                if sa["cold_chain_alert"] and not sb["cold_chain_alert"]:
                    totals["cold_chain_alerts_raised"] += 1
                    rows.append({**base, "kind": "temperature", "item": med, "unit": "°C",
                                 "before": b["temp"], "after": a["temp"],
                                 "risk_before": sb["risk"], "risk_after": sa["risk"],
                                 "days_before": sb["days"], "days_after": sa["days"]})
                continue
            if sa["level"] == sb["level"] and not risk_up:
                continue
            totals["stock_items_changed"] += 1
            totals["stock_units_lost"] += max(0.0, sb["level"] - sa["level"])
            if risk_up:
                totals["risk_escalations"] += 1
                if sa["risk"] == "critical":
                    totals["newly_critical"] += 1
            rows.append({**base, "kind": "stock", "item": med, "unit": sb["unit"],
                         "before": sb["level"], "after": sa["level"],
                         "risk_before": sb["risk"], "risk_after": sa["risk"],
                         "days_before": sb["days"], "days_after": sa["days"]})
        if "beds" in b and a["beds"] != b["beds"]:
            totals["beds_newly_occupied"] += a["beds"] - b["beds"]
            rows.append({**base, "kind": "beds", "item": "Beds occupied", "unit": "beds",
                         "before": b["beds"], "after": a["beds"], "capacity": phc["beds_total"]})
        if "visits" in b and a["visits"] != b["visits"]:
            totals["extra_opd_visits"] += a["visits"] - b["visits"]
            rows.append({**base, "kind": "footfall", "item": "OPD visits today", "unit": "visits",
                         "before": b["visits"], "after": a["visits"]})
    totals["stock_units_lost"] = round(totals["stock_units_lost"], 1)

    # Most severe first: risk escalations, then the largest relative drop.
    def severity(r: dict) -> tuple:
        esc = _RISK_RANK.get(r.get("risk_after", "low"), 0) - _RISK_RANK.get(r.get("risk_before", "low"), 0)
        rel = abs(r["after"] - r["before"]) / max(abs(r["before"]), 1)
        return (-esc, -rel)

    rows.sort(key=severity)
    return {
        **rec,
        "simulated": True,
        "triggered_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "totals": totals,
        "rows_total": len(rows),
        "changes": rows[:IMPACT_ROW_LIMIT],
    }


def trigger_crisis(target_type: str, target_name: str, crisis_type: str, intensity: float = 1.0) -> dict:
    """Mutate stock levels and bed histories for target facilities to simulate a
    health crisis/outbreak, scaled by ``intensity`` (see CRISIS_SEVERITY) with
    per-facility variance so a state-wide crisis doesn't drain every PHC
    identically. Returns a before/after impact record of every value it
    changed (also kept in ``CRISIS_IMPACTS``)."""
    if crisis_type not in CRISIS_DEPLETION:
        raise ValueError(f"Unknown crisis type '{crisis_type}'")
    if not (INTENSITY_MIN <= intensity <= INTENSITY_MAX):
        raise ValueError(f"intensity must be between {INTENSITY_MIN} and {INTENSITY_MAX}")
    target_ids = crisis_targets(target_type, target_name)
    if not target_ids:
        raise ValueError(f"No facilities match {target_type} '{target_name}'")
    # Re-triggering the exact same crisis (a double-click, a resubmit) would
    # otherwise duplicate the banner tag and double-apply the depletion/surge
    # on top of itself.
    if any(c["target_type"] == target_type and c["target_name"] == target_name and c["crisis_type"] == crisis_type
           for c in ACTIVE_CRISES):
        raise ValueError(f"{crisis_type} is already active for {target_type} '{target_name}'")

    before = _crisis_snapshot(target_ids, crisis_type)
    severity = CRISIS_SEVERITY[crisis_type]

    # Record active crisis — in memory for this process and in SQLite so it
    # (and the dashboard banner) survives a backend restart. Intensity is
    # kept only on the in-memory record (like CRISIS_IMPACTS): crisis_log's
    # columns are fixed and there is no migration path for an existing db.
    rec = {"target_type": target_type, "target_name": target_name, "crisis_type": crisis_type, "intensity": intensity}
    ACTIVE_CRISES.append(rec)
    db.record_crisis(rec)

    # Mutate inventories and beds
    for pid in target_ids:
        if crisis_type == "Cold Chain Failure":
            trigger_cold_chain_failure(pid)
            continue

        variance = _facility_variance(pid, crisis_type)

        # Bed occupancy surge: close a fraction of the gap to full capacity,
        # not jump straight to it — a facility already near-full has little
        # room left to visibly surge, one with headroom absorbs more.
        if crisis_type in BED_SURGE_CRISES and severity["bed_fraction"] > 0:
            total_beds = PHC_BY_ID[pid]["beds_total"]
            bed_frac = _scaled_fraction(severity["bed_fraction"], intensity, variance, cap=1.0)
            current_occ = BED_HISTORY[pid]["occupied"]
            n_days = len(current_occ)
            baseline = current_occ[max(0, n_days - 15)]
            target_occ = round(baseline + (total_beds - baseline) * bed_frac)
            for idx in range(max(0, n_days - 14), n_days):
                days_since_start = idx - max(0, n_days - 14) + 1
                ramped = round(baseline + (target_occ - baseline) * (days_since_start / 14))
                # A crisis only ever adds pressure, never frees up beds that were already fuller.
                current_occ[idx] = max(current_occ[idx], min(total_beds, ramped))

        # OPD footfall surge — keeps patient volume consistent with the extra
        # medicine consumption below, so the anomaly detector doesn't mistake a
        # genuine outbreak at a crisis PHC for pilferage. Same "scale only the
        # excess over 1.0" shape as weather_impact.py's demand multipliers.
        if crisis_type in FOOTFALL_SURGE_CRISES and pid in FOOTFALL_HISTORY:
            multiplier = 1.0 + (severity["footfall_multiplier"] - 1.0) * intensity * variance
            visits = FOOTFALL_HISTORY[pid]["visits"]
            n_days = len(visits)
            for idx in range(max(0, n_days - 14), n_days):
                visits[idx] = round(visits[idx] * multiplier)

        stock_frac = _scaled_fraction(severity["stock_fraction"], intensity, variance)
        for med in CRISIS_DEPLETION[crisis_type]:
            if med in STOCK_HISTORY[pid]:
                stock = STOCK_HISTORY[pid][med]
                levels = stock["levels"]
                n_days = len(levels)
                crash_start_idx = max(0, n_days - 14)
                window = n_days - crash_start_idx
                # Deplete a target fraction of the facility's actual current
                # level (today, levels[-1]) — not a fixed floor, and not the
                # day just before the crash window, which can land on an
                # arbitrary historical trough (a facility can have restocked
                # since). A mild simulated outbreak should leave most
                # facilities with real stock left, and a severe one should
                # still leave a small remainder rather than an implausible,
                # perfectly-clean zero. The floor is reached by the end of
                # the window by construction, so intensity/variance are
                # always visible in the outcome — not sometimes overridden
                # by an independent crash rate.
                start_val = levels[-1]
                floor_val = start_val * (1.0 - stock_frac)

                # A crisis-driven crash is never slower than the facility's
                # already-elevated organic consumption trend (check_surge),
                # so a fast-depleting facility isn't dragged back up to the
                # floor-based curve.
                from app.services.forecasting import check_surge
                _, recent_rate, _ = check_surge(levels)

                for idx in range(crash_start_idx, n_days):
                    days_since_start = idx - crash_start_idx + 1
                    progress = days_since_start / window
                    on_curve = start_val - (start_val - floor_val) * progress
                    organic = start_val - days_since_start * recent_rate
                    crashed = max(floor_val, min(on_curve, organic))
                    # A crisis only ever removes stock, never adds it.
                    levels[idx] = round(min(levels[idx], crashed), 1)

    # Save to disk to make the crisis effects survive restarts
    save_stock_history()
    save_bed_history()
    save_footfall_history()

    # Clear in-memory forecast cache
    from app.services.forecasting import clear_forecast_cache
    clear_forecast_cache()

    impact = _crisis_impact(rec, target_ids, before, _crisis_snapshot(target_ids, crisis_type))
    CRISIS_IMPACTS.append(impact)
    return impact
