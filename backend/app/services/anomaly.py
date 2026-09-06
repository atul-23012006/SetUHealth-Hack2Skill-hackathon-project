"""Consumption-vs-footfall anomaly detection.

Every PHC reports two independent signals: how fast its medicine stock draws
down, and how many patients walk through the door (OPD footfall). In a
well-run facility those move together. When they diverge sharply, something
is wrong:

* **over-consumption** — stock is disappearing far faster than the patient
  load can explain. Possible pilferage, leakage, or expiry write-offs booked
  as dispensing.
* **under-reporting** — footfall is steady or rising but the stock ledger
  barely moves. Usually a data-entry breakdown (registers not digitised),
  sometimes diversion masked by fake bookkeeping.

Method: for each PHC we take the trailing ``WINDOW`` days and compute a
consumption index (how the window's dispensing rate compares to that
facility's own pre-window baseline, averaged across medicines) and a footfall
index (same idea for patient visits). Their ratio is the tell. We take the
log-ratio across the whole network, and flag facilities more than
``Z_FLAG`` robust standard deviations (median / MAD) from the network median.
The detector never looks at the ground-truth labels in the generator — it
rediscovers the seeded anomalies purely from this distribution.
"""
import math
import statistics

from app.services import store

WINDOW = 21            # trailing days scored
MIN_BASELINE_DAYS = 14  # need at least this much pre-window history
Z_FLAG = 2.5           # robust z-score past which a PHC is flagged
Z_HIGH = 3.5           # and past which it is "high" severity
_EPS = 1e-6


def _daily_consumption(levels: list[float]) -> list[float]:
    """Positive day-over-day drawdown, ignoring restock jumps and stockout days."""
    out = []
    for i in range(1, len(levels)):
        if levels[i - 1] > 0.05:
            out.append(max(0.0, levels[i - 1] - levels[i]))
    return out


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _phc_indices(phc_id: str) -> dict | None:
    """Return the consumption index, footfall index and supporting detail for
    one PHC, or None if there isn't enough history to score it."""
    foot_rec = store.FOOTFALL_HISTORY.get(phc_id)
    if not foot_rec:
        return None
    visits = foot_rec["visits"]
    if len(visits) < WINDOW + MIN_BASELINE_DAYS:
        return None

    window_visits = _mean(visits[-WINDOW:])
    baseline_visits = _mean(visits[:-WINDOW])
    if baseline_visits < _EPS:
        return None
    footfall_index = window_visits / baseline_visits

    per_med_ratio = []
    contributions = []
    for med, rec in store.STOCK_HISTORY[phc_id].items():
        levels = rec["levels"]
        if len(levels) < WINDOW + MIN_BASELINE_DAYS:
            continue
        window_rate = _mean(_daily_consumption(levels[-WINDOW - 1:]))
        baseline_rate = _mean(_daily_consumption(levels[: -WINDOW]))
        if baseline_rate < 0.05 and window_rate < 0.05:
            continue  # dormant medicine, no signal either way
        ratio = window_rate / max(baseline_rate, 0.05)
        per_med_ratio.append(ratio)
        contributions.append({
            "medicine": med,
            "window_rate": round(window_rate, 2),
            "baseline_rate": round(baseline_rate, 2),
            "unit": rec["unit"],
            "ratio": round(ratio, 2),
        })

    if not per_med_ratio:
        return None

    consumption_index = _mean(per_med_ratio)
    contributions.sort(key=lambda c: abs(math.log((c["ratio"] + _EPS))), reverse=True)
    return {
        "phc_id": phc_id,
        "consumption_index": consumption_index,
        "footfall_index": footfall_index,
        "log_ratio": math.log((consumption_index + _EPS) / (footfall_index + _EPS)),
        "window_visits": round(window_visits, 1),
        "baseline_visits": round(baseline_visits, 1),
        "contributions": contributions[:3],
    }


def detect_all(state: str | None = None) -> list[dict]:
    """Score every PHC and return the flagged consumption anomalies, worst first."""
    scored = []
    for phc_id in store.STOCK_HISTORY:
        phc = store.PHC_BY_ID[phc_id]
        if state and phc["state"] != state:
            continue
        idx = _phc_indices(phc_id)
        if idx:
            scored.append(idx)

    if len(scored) < 5:
        return []

    log_ratios = [s["log_ratio"] for s in scored]
    median = statistics.median(log_ratios)
    mad = statistics.median([abs(x - median) for x in log_ratios]) or _EPS
    robust_sd = 1.4826 * mad

    anomalies = []
    for s in scored:
        z = (s["log_ratio"] - median) / robust_sd
        if abs(z) < Z_FLAG:
            continue
        phc = store.PHC_BY_ID[s["phc_id"]]
        direction = "over_consumption" if z > 0 else "under_reporting"
        consumption_pct = round((s["consumption_index"] - 1) * 100)
        footfall_pct = round((s["footfall_index"] - 1) * 100)
        anomalies.append({
            "phc_id": s["phc_id"],
            "phc_name": phc["name"],
            "district": phc["district"],
            "state": phc["state"],
            "direction": direction,
            "severity": "high" if abs(z) >= Z_HIGH else "medium",
            "z_score": round(z, 2),
            "consumption_change_pct": consumption_pct,
            "footfall_change_pct": footfall_pct,
            "window_days": WINDOW,
            "avg_daily_visits": s["window_visits"],
            "baseline_daily_visits": s["baseline_visits"],
            "flagged_medicines": [c["medicine"] for c in s["contributions"]],
            "detail": s["contributions"],
            "headline": _headline(phc, direction, consumption_pct, footfall_pct),
        })

    anomalies.sort(key=lambda a: abs(a["z_score"]), reverse=True)
    return anomalies


def _headline(phc: dict, direction: str, consumption_pct: int, footfall_pct: int) -> str:
    where = f"{phc['name']} ({phc['district']}, {phc['state']})"
    if direction == "over_consumption":
        return (
            f"{where}: stock is drawing down {consumption_pct:+d}% vs its own baseline "
            f"while patient footfall moved only {footfall_pct:+d}% — consumption not "
            f"explained by patient volume."
        )
    return (
        f"{where}: patient footfall moved {footfall_pct:+d}% but recorded dispensing "
        f"changed only {consumption_pct:+d}% — stock ledger is not tracking real usage."
    )


def explain(phc_id: str, lang: str = "en") -> dict:
    """Full record for one flagged PHC plus an AI-written investigator note."""
    match = next((a for a in detect_all() if a["phc_id"] == phc_id), None)
    if not match:
        return {"phc_id": phc_id, "flagged": False, "explanation": None}

    from app.services import genai as genai_svc

    match["flagged"] = True
    match["explanation"] = genai_svc.explain_anomaly(match, lang)
    return match
