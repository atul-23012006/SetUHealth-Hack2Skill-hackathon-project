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

**Known blind spot and how it's mitigated here:** a network-median/MAD
z-score is computed fresh on every call, against whatever facilities are in
that run — never against a facility's own history, and never against a fixed
baseline. If many facilities drift the same direction at once (a genuine
network-wide event), the median moves with them and everyone's z-score stays
small — a real systemic event can read as "nothing unusual." Two mitigations
are layered on top of the plain network z-score:

1. **Facility-vs-self history** (``_self_history_log_ratios`` /
   ``_self_z_score``): each facility's current log_ratio is also compared
   against several earlier anchor points in *its own* history, independent
   of what the rest of the network is doing that day. A facility is flagged
   if either the network z-score or its own self-history z-score crosses the
   threshold — so a facility drifting alone still gets caught even during a
   period where many others are also drifting (which would otherwise mask it
   in the network comparison).
2. **Median drift tracking** (``network_median_drift``): the network median
   itself is logged on every call. A sudden jump in the median across a
   short window is a systemic-shift signal in its own right, surfaced
   separately from any single facility's flag.

This does not make median/MAD outlier detection perfect — it remains a real,
known limitation of unsupervised distributional methods — but it closes the
specific failure mode where a synchronized network-wide drift goes
completely unflagged.
"""
import math
import statistics
from datetime import datetime

from app.services import store

WINDOW = 21            # trailing days scored
MIN_BASELINE_DAYS = 14  # need at least this much pre-window history
Z_FLAG = 2.5           # robust z-score past which a PHC is flagged
Z_HIGH = 3.5           # and past which it is "high" severity
_EPS = 1e-6

SELF_HISTORY_STEP = 7    # days between each historical self-comparison anchor
SELF_HISTORY_POINTS = 6  # how many historical anchors to sample
SELF_Z_FLAG = 2.5        # robust self-history z-score past which a PHC is flagged

_MEDIAN_HISTORY: list[tuple[str, float]] = []
_MEDIAN_HISTORY_CAP = 500
MEDIAN_DRIFT_Z = 2.5  # robust z past which a jump in the network median itself is "systemic"


def _daily_consumption(levels: list[float]) -> list[float]:
    """Positive day-over-day drawdown, ignoring restock jumps and stockout days."""
    out = []
    for i in range(1, len(levels)):
        if levels[i - 1] > 0.05:
            out.append(max(0.0, levels[i - 1] - levels[i]))
    return out


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def _phc_indices(phc_id: str, end: int | None = None) -> dict | None:
    """Return the consumption index, footfall index and supporting detail for
    one PHC, or None if there isn't enough history to score it.

    ``end`` truncates both the footfall and stock time series to their first
    ``end`` days before scoring — this is what lets ``_self_history_log_ratios``
    re-run the exact same window/baseline comparison anchored at several
    earlier points in the facility's own history, rather than only ever
    looking at "now"."""
    foot_rec = store.FOOTFALL_HISTORY.get(phc_id)
    if not foot_rec:
        return None
    visits = foot_rec["visits"] if end is None else foot_rec["visits"][:end]
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
        levels = rec["levels"] if end is None else rec["levels"][:end]
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


def _self_history_log_ratios(phc_id: str) -> list[float]:
    """Re-run this facility's own consumption/footfall comparison anchored at
    several earlier points in its history, stepping back ``SELF_HISTORY_STEP``
    days at a time. Gives a facility-vs-self distribution of log_ratio that
    is completely independent of what the rest of the network is doing on
    any given day — the piece the plain network median/MAD score can't see."""
    foot_rec = store.FOOTFALL_HISTORY.get(phc_id)
    if not foot_rec:
        return []
    total_len = len(foot_rec["visits"])
    history = []
    for k in range(1, SELF_HISTORY_POINTS + 1):
        end = total_len - k * SELF_HISTORY_STEP
        if end < WINDOW + MIN_BASELINE_DAYS:
            break
        idx = _phc_indices(phc_id, end=end)
        if idx:
            history.append(idx["log_ratio"])
    return history


def _self_z_score(current_log_ratio: float, history: list[float]) -> float | None:
    """Robust z-score of the current log_ratio against this facility's own
    historical log_ratios. None if there isn't enough self-history yet."""
    if len(history) < 3:
        return None
    median = statistics.median(history)
    mad = statistics.median([abs(x - median) for x in history]) or _EPS
    robust_sd = 1.4826 * mad
    if robust_sd < _EPS:
        return None
    return (current_log_ratio - median) / robust_sd


def _record_network_median(median: float) -> None:
    _MEDIAN_HISTORY.append((datetime.now().isoformat(), round(median, 4)))
    if len(_MEDIAN_HISTORY) > _MEDIAN_HISTORY_CAP:
        del _MEDIAN_HISTORY[: len(_MEDIAN_HISTORY) - _MEDIAN_HISTORY_CAP]


def network_median_drift() -> dict:
    """Is the cross-network median itself moving? A single facility's z-score
    is measured *relative to* this same median, so it goes blind exactly when
    every facility drifts together (a real systemic event). Tracking the
    median's own trajectory across calls surfaces that case as its own
    signal — a "systemic shift detected" flag independent of any one
    facility's anomaly flag. Call alongside ``detect_all`` for a dashboard
    banner; empty/unavailable until enough calls have accumulated history."""
    if len(_MEDIAN_HISTORY) < 6:
        return {"available": False, "systemic_shift": False, "history": list(_MEDIAN_HISTORY)}
    values = [m for _, m in _MEDIAN_HISTORY]
    baseline, current = values[:-1], values[-1]
    base_median = statistics.median(baseline)
    mad = statistics.median([abs(x - base_median) for x in baseline]) or _EPS
    robust_sd = 1.4826 * mad
    drift_z = (current - base_median) / robust_sd if robust_sd > _EPS else 0.0
    return {
        "available": True,
        "systemic_shift": abs(drift_z) >= MEDIAN_DRIFT_Z,
        "drift_z": round(drift_z, 2),
        "current_median": round(current, 4),
        "baseline_median": round(base_median, 4),
        "history": _MEDIAN_HISTORY[-50:],
    }


def detect_all(state: str | None = None) -> list[dict]:
    """Score every PHC and return the flagged consumption anomalies, worst first.

    The network median/MAD baseline is always computed across the *entire*
    network, never just the requested state — a state filter narrows what's
    returned, not what the facilities are measured against. (Scoring only
    within one state would make the baseline sample size- and
    composition-dependent on the filter, so the same facility could look
    anomalous or not purely because of which state was queried.)"""
    scored = []
    for phc_id in store.STOCK_HISTORY:
        idx = _phc_indices(phc_id)
        if idx:
            scored.append(idx)

    if len(scored) < 5:
        return []

    log_ratios = [s["log_ratio"] for s in scored]
    median = statistics.median(log_ratios)
    mad = statistics.median([abs(x - median) for x in log_ratios]) or _EPS
    robust_sd = 1.4826 * mad
    _record_network_median(median)

    anomalies = []
    for s in scored:
        phc = store.PHC_BY_ID[s["phc_id"]]
        if state and phc["state"] != state:
            continue

        z = (s["log_ratio"] - median) / robust_sd
        self_history = _self_history_log_ratios(s["phc_id"])
        self_z = _self_z_score(s["log_ratio"], self_history)

        network_flagged = abs(z) >= Z_FLAG
        self_flagged = self_z is not None and abs(self_z) >= SELF_Z_FLAG
        if not (network_flagged or self_flagged):
            continue

        # Direction/severity follow whichever signal is stronger — usually
        # they agree, but a facility drifting alone during a network-wide
        # event can have a small network z and a large self z (or vice versa).
        driving_z = z if abs(z) >= (abs(self_z) if self_z is not None else 0) else self_z
        direction = "over_consumption" if driving_z > 0 else "under_reporting"
        flag_source = "network+self" if (network_flagged and self_flagged) else ("self_history" if self_flagged else "network")
        consumption_pct = round((s["consumption_index"] - 1) * 100)
        footfall_pct = round((s["footfall_index"] - 1) * 100)
        anomalies.append({
            "phc_id": s["phc_id"],
            "phc_name": phc["name"],
            "district": phc["district"],
            "state": phc["state"],
            "direction": direction,
            "severity": "high" if max(abs(z), abs(self_z) if self_z is not None else 0) >= Z_HIGH else "medium",
            "z_score": round(z, 2),
            "self_z_score": round(self_z, 2) if self_z is not None else None,
            "flag_source": flag_source,
            "consumption_change_pct": consumption_pct,
            "footfall_change_pct": footfall_pct,
            "window_days": WINDOW,
            "avg_daily_visits": s["window_visits"],
            "baseline_daily_visits": s["baseline_visits"],
            "flagged_medicines": [c["medicine"] for c in s["contributions"]],
            "detail": s["contributions"],
            "headline": _headline(phc, direction, consumption_pct, footfall_pct),
        })

    anomalies.sort(
        key=lambda a: max(abs(a["z_score"]), abs(a["self_z_score"]) if a["self_z_score"] is not None else 0),
        reverse=True,
    )
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
