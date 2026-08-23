"""Federated aggregation layer.

Two levels are simulated, mirroring how this would run in production:

1. State node -> national server: each state's node computes local summary
   statistics (mean depletion rate per medicine category, risk counts,
   bed/staff pressure) from its own PHC records. Only these summaries -
   never PHC-level or patient-level records - are sent upward and federated-
   averaged (weighted by facility count) into a national model prior.

2. National -> BRICS partners: the same mechanism extends across countries.
   Partner-nation nodes (Brazil, South Africa, and observer nations) are
   simulated here with seeded synthetic summaries standing in for their own
   local nodes, since we don't have their facility-level data - the
   federation math is identical to what would run against a real partner
   API. Nations combine into a shared global prior without any raw record
   ever crossing a border, which is the property that makes this legally
   and diplomatically viable at BRICS scale.
"""
import random

from app.services import store
from app.services.forecasting import forecast_all

_PARTNER_SEED = 7


def state_summary(state: str) -> dict:
    phcs = [p for p in store.PHCS if p["state"] == state]
    forecasts = [f for f in forecast_all(state=state)]
    by_category = {}
    for f in forecasts:
        cat = store.STOCK_HISTORY[f["phc_id"]][f["medicine"]]["category"]
        by_category.setdefault(cat, []).append(f["daily_depletion_rate"])
    category_rates = {c: round(sum(v) / len(v), 3) for c, v in by_category.items() if v}
    critical = sum(1 for f in forecasts if f["risk"] == "critical")
    warning = sum(1 for f in forecasts if f["risk"] == "warning")
    return {
        "node": state,
        "facility_count": len(phcs),
        "category_depletion_rates": category_rates,
        "critical_alerts": critical,
        "warning_alerts": warning,
    }


def national_federated_prior() -> dict:
    """Federated-average state summaries into a national model prior,
    weighted by each state's facility count."""
    states = sorted({p["state"] for p in store.PHCS})
    summaries = [state_summary(s) for s in states]
    total_facilities = sum(s["facility_count"] for s in summaries)

    categories = {m["category"] for m in store.MEDICINES}
    prior = {}
    for cat in categories:
        weighted_sum = 0.0
        weight_total = 0.0
        for s in summaries:
            if cat in s["category_depletion_rates"]:
                w = s["facility_count"]
                weighted_sum += s["category_depletion_rates"][cat] * w
                weight_total += w
        if weight_total:
            prior[cat] = round(weighted_sum / weight_total, 3)

    return {
        "participating_nodes": states,
        "total_facilities": total_facilities,
        "category_depletion_prior": prior,
        "node_summaries": summaries,
    }


def _synthetic_partner_summary(nation: str, seed_offset: int) -> dict:
    rng = random.Random(_PARTNER_SEED + seed_offset)
    categories = {m["category"] for m in store.MEDICINES}
    rates = {cat: round(rng.uniform(1.5, 9.0), 3) for cat in categories}
    return {
        "node": nation,
        "facility_count": rng.randint(4000, 20000),
        "category_depletion_rates": rates,
        "critical_alerts": rng.randint(50, 900),
        "warning_alerts": rng.randint(100, 1500),
    }


def brics_shared_prior() -> dict:
    india = national_federated_prior()
    partners = [
        _synthetic_partner_summary("Brazil", 1),
        _synthetic_partner_summary("South Africa", 2),
        _synthetic_partner_summary("Indonesia (observer)", 3),
        _synthetic_partner_summary("Egypt (observer)", 4),
    ]
    india_node = {
        "node": "India",
        "facility_count": india["total_facilities"],
        "category_depletion_rates": india["category_depletion_prior"],
        "critical_alerts": sum(s["critical_alerts"] for s in india["node_summaries"]),
        "warning_alerts": sum(s["warning_alerts"] for s in india["node_summaries"]),
    }
    all_nodes = [india_node] + partners
    categories = {m["category"] for m in store.MEDICINES}
    global_prior = {}
    for cat in categories:
        weighted_sum = sum(n["category_depletion_rates"].get(cat, 0) * n["facility_count"] for n in all_nodes)
        weight_total = sum(n["facility_count"] for n in all_nodes if cat in n["category_depletion_rates"])
        if weight_total:
            global_prior[cat] = round(weighted_sum / weight_total, 3)

    return {
        "nodes": all_nodes,
        "global_category_depletion_prior": global_prior,
        "note": "Only aggregated, weighted category-level statistics are exchanged between nation nodes. No facility-level or patient-level record ever leaves its country of origin.",
    }
