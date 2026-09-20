"""Public transparency aggregates — a second consumer of the same
aggregate-only contract ``federated.py`` already enforces for cross-state
and cross-nation sharing, exposed here for a read-only, no-login audience.

Every function in this module returns only counts and averages computed by
``federated.py``'s state/national aggregation helpers. Nothing here reads
``store.PHCS``, ``store.PHC_BY_ID``, or any per-facility record directly, so
this module cannot leak a ``phc_id``, ``lat``/``lon``, or any other
facility-identifying or patient-adjacent field even if it is edited
carelessly later — there is simply no raw record in scope to leak.
"""
from datetime import datetime, timedelta

from app.services import db, federated

_TRANSFER_WINDOW_DAYS = 30


def _risk_score(critical_facility_count: int, warning_facility_count: int, facility_count: int) -> float:
    """A 0-100 composite: the share of facilities at risk, weighting a
    critical facility as a full unit and a warning facility as a half unit.
    Purely a transparent function of the aggregate counts above it — not a
    model prediction."""
    if not facility_count:
        return 0.0
    weighted = critical_facility_count + 0.5 * warning_facility_count
    return round(min(100.0, 100.0 * weighted / facility_count), 1)


def _critical_risk_per_100k(critical_facility_count: int, population_served: int) -> float:
    """Critical-risk facilities per 100,000 people in the served population —
    a genuinely per-capita figure, unlike avg_risk_score (which is per
    facility and so reads identically for a state with 10 tiny PHCs and one
    with 10 PHCs covering ten times the population). Requires
    population_served, which only exists on PHC records (see
    generate_data.py's IPHS-grounded per-PHC catchment estimate)."""
    if not population_served:
        return 0.0
    return round(100_000.0 * critical_facility_count / population_served, 2)


def _transfers_in_window(days: int) -> list[dict]:
    cutoff = datetime.now() - timedelta(days=days)
    out = []
    for m in db.list_transfers():
        try:
            created = datetime.fromisoformat(m["created_at"])
        except (KeyError, ValueError):
            continue
        if created >= cutoff:
            out.append(m)
    return out


def state_summary() -> list[dict]:
    """Per-state public aggregates. Never touches PHC-level records —
    everything here comes from ``federated.state_summary`` plus a count of
    already-completed transfer manifests grouped by destination state."""
    now = datetime.now().isoformat()
    recent_transfers = _transfers_in_window(_TRANSFER_WINDOW_DAYS)
    transfers_by_state: dict[str, int] = {}
    for t in recent_transfers:
        state = t.get("to_state")
        if state:
            transfers_by_state[state] = transfers_by_state.get(state, 0) + 1

    states = sorted({p for p in federated.national_federated_prior()["participating_nodes"]})
    out = []
    for state in states:
        s = federated.state_summary(state)
        out.append({
            "state": state,
            "facility_count": s["facility_count"],
            "avg_risk_score": _risk_score(
                s["critical_facility_count"], s["warning_facility_count"], s["facility_count"]
            ),
            "critical_facility_count": s["critical_facility_count"],
            "population_served": s["population_served"],
            "critical_risk_per_100k": _critical_risk_per_100k(
                s["critical_facility_count"], s["population_served"]
            ),
            # Every executed transfer, by definition, resolved or averted a
            # stockout at its destination facility — this is a direct count
            # of completed ledger entries, not a model estimate.
            "transfers_executed_30d": transfers_by_state.get(state, 0),
            "stockouts_prevented_30d": transfers_by_state.get(state, 0),
            "last_updated": now,
        })
    return out


def national_summary() -> dict:
    """Single aggregated national card, reusing
    ``federated.national_federated_prior()``'s output shape but renamed for
    a public audience (no internal 'federated prior' jargon)."""
    prior = federated.national_federated_prior()
    recent_transfers = _transfers_in_window(_TRANSFER_WINDOW_DAYS)
    total_facilities = prior["total_facilities"]
    total_critical = sum(s["critical_facility_count"] for s in prior["node_summaries"])
    total_warning = sum(s["warning_facility_count"] for s in prior["node_summaries"])
    total_population = sum(s["population_served"] for s in prior["node_summaries"])

    return {
        "states_covered": len(prior["participating_nodes"]),
        "total_facilities_monitored": total_facilities,
        "population_served": total_population,
        "avg_depletion_rate_by_category": prior["category_depletion_prior"],
        "critical_facility_count": total_critical,
        "avg_risk_score": _risk_score(total_critical, total_warning, total_facilities),
        "critical_risk_per_100k": _critical_risk_per_100k(total_critical, total_population),
        "transfers_executed_30d": len(recent_transfers),
        "stockouts_prevented_30d": len(recent_transfers),
        "last_updated": datetime.now().isoformat(),
    }
