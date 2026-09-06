"""Cross-facility redistribution recommendation engine using PuLP optimization.

For each medicine, PHCs are split into deficit (critical/warning stockout
risk) and surplus (comfortably above reorder level with no near-term risk)
pools. Deficit facilities are matched to surplus facilities by solving a
transportation optimization problem that maximizes satisfied deficit while
minimizing transport costs (distance + district/state penalties).
"""
import math
import pulp

from app.services import store
from app.services.forecasting import forecast_all, forecast_medicine

SURPLUS_MARGIN_DAYS = 25  # no risk before this many days => can be a donor
MIN_SPARE_FRACTION = 0.35  # keep at least this fraction of capacity as buffer


def _haversine_km(a, b) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def recommend_for_medicine(medicine: str) -> list[dict]:
    forecasts = [f for f in forecast_all() if f["medicine"] == medicine]
    deficits = [f for f in forecasts if f["risk"] in ("critical", "warning") and not f.get("cold_chain_alert")]
    surplus = []
    
    for f in forecasts:
        if f.get("cold_chain_alert"):
            # If cold chain alert is active, evacuate all remaining stock before it spoils
            if f["current_level"] > 0.05:
                surplus.append({**f, "spare_units": round(f["current_level"], 1)})
        else:
            rec = store.STOCK_HISTORY[f["phc_id"]][medicine]
            spare = f["current_level"] - rec["capacity"] * MIN_SPARE_FRACTION
            if (f["days_to_stockout"] is None or f["days_to_stockout"] >= SURPLUS_MARGIN_DAYS) and spare > 0:
                surplus.append({**f, "spare_units": round(spare, 1)})

    if not deficits or not surplus:
        return []

    # Setup the linear programming model
    prob = pulp.LpProblem("Redistribution_Optimization", pulp.LpMinimize)

    # Variables: x[(s, d)] is the quantity transferred from surplus[s] to deficit[d]
    x = {}
    for s_idx in range(len(surplus)):
        for d_idx in range(len(deficits)):
            x[(s_idx, d_idx)] = pulp.LpVariable(
                f"x_{s_idx}_{d_idx}", lowBound=0, cat=pulp.LpContinuous
            )

    # Variables: unmet[d] is the unsatisfied deficit for recipient[d]
    unmet = {}
    needed_vals = {}
    for d_idx, d in enumerate(deficits):
        rec = store.STOCK_HISTORY[d["phc_id"]][medicine]
        needed = max(0.0, rec["reorder_level"] * 1.5 - d["current_level"])
        needed_vals[d_idx] = needed
        unmet[d_idx] = pulp.LpVariable(
            f"unmet_{d_idx}", lowBound=0, cat=pulp.LpContinuous
        )

    # Constraints:
    # 1. Total sent from surplus[s] cannot exceed its spare units
    for s_idx, s in enumerate(surplus):
        prob += pulp.lpSum(x[(s_idx, d_idx)] for d_idx in range(len(deficits))) <= s["spare_units"], f"Donor_Spare_{s_idx}"

    # 2. Total received + unmet must equal the needed amount at deficit[d]
    for d_idx, d in enumerate(deficits):
        prob += pulp.lpSum(x[(s_idx, d_idx)] for s_idx in range(len(surplus))) + unmet[d_idx] == needed_vals[d_idx], f"Recipient_Need_{d_idx}"

    # Look up medicine tier and calculate per-facility urgency weights to prioritize critical, high-tier shortages
    med_info = next((m for m in store.MEDICINES if m["name"] == medicine), None)
    tier = med_info.get("tier", 3) if med_info else 3
    base_unmet_penalty = 100000.0
    tier_weight = {1: 3.0, 2: 2.0, 3: 1.0}[tier]

    weight = {}
    for d_idx, d in enumerate(deficits):
        risk_weight = 2.0 if d["risk"] == "critical" else 1.0
        weight[d_idx] = base_unmet_penalty * tier_weight * risk_weight
        d_phc = store.PHC_BY_ID[d["phc_id"]]
        print(f"[OPTIMIZER] Medicine: {medicine} (Tier {tier}) | Facility: {d_phc['name']} (Risk: {d['risk']}) -> unmet_penalty: {weight[d_idx]}")

    cost_terms = []
    for s_idx, s in enumerate(surplus):
        s_phc = store.PHC_BY_ID[s["phc_id"]]
        for d_idx, d in enumerate(deficits):
            d_phc = store.PHC_BY_ID[d["phc_id"]]
            dist = _haversine_km(s_phc, d_phc)
            cross_district = s_phc["district"] != d_phc["district"]
            cross_state = s_phc["state"] != d_phc["state"]
            
            # Penalize long-distance and out-of-district/state moves to prefer local optimization
            cost = dist + (100.0 if cross_district else 0.0) + (500.0 if cross_state else 0.0)
            if s.get("cold_chain_alert"):
                # Heavily reward transfers out of failing cold chains to prioritize evacuation
                cost -= 100000.0
            cost_terms.append(cost * x[(s_idx, d_idx)])

    prob += pulp.lpSum(weight[d_idx] * unmet[d_idx] for d_idx in range(len(deficits))) + pulp.lpSum(cost_terms)

    # Solve the problem
    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    recommendations = []
    for s_idx, s in enumerate(surplus):
        s_phc = store.PHC_BY_ID[s["phc_id"]]
        for d_idx, d in enumerate(deficits):
            d_phc = store.PHC_BY_ID[d["phc_id"]]
            val = x[(s_idx, d_idx)].varValue
            if val and val > 0.05:
                val = round(val, 1)
                recommendations.append({
                    "medicine": medicine,
                    "unit": d["unit"],
                    "from_phc_id": s["phc_id"],
                    "from_phc_name": s_phc["name"],
                    "from_state": s_phc["state"],
                    "from_district": s_phc["district"],
                    "to_phc_id": d["phc_id"],
                    "to_phc_name": d_phc["name"],
                    "to_state": d_phc["state"],
                    "to_district": d_phc["district"],
                    "quantity": val,
                    "distance_km": round(_haversine_km(s_phc, d_phc), 1),
                    "cross_state": s_phc["state"] != d_phc["state"],
                    "urgency": d["risk"],
                    "explanation": None,  # populated lazily on request
                })

    return recommendations


def _greedy_transport(deficits: list[dict], surplus: list[dict]) -> list[dict]:
    """Nearest-first matching of provider facilities (``surplus``, each with a
    ``spare`` amount) to facilities in need (``deficits``, each with a ``need``
    amount). Prefers in-district then in-state moves, then shortest distance.
    Returns raw pairings: ``from`` is the provider, ``to`` is the needer.
    Used for beds and staff, where a full LP is overkill — the pools are small
    and the objective is simply "cover the worst shortfalls with the closest
    spare capacity".
    """
    remaining_spare = {s["phc_id"]: s["spare"] for s in surplus}
    pairings = []
    for d in sorted(deficits, key=lambda x: -x["need"]):
        need = d["need"]
        d_phc = store.PHC_BY_ID[d["phc_id"]]
        candidates = []
        for s in surplus:
            if remaining_spare[s["phc_id"]] < 0.5:
                continue
            s_phc = store.PHC_BY_ID[s["phc_id"]]
            dist = _haversine_km(s_phc, d_phc)
            rank = (
                s_phc["district"] != d_phc["district"],
                s_phc["state"] != d_phc["state"],
                dist,
            )
            candidates.append((rank, dist, s["phc_id"]))
        candidates.sort()
        for _rank, dist, s_id in candidates:
            if need < 0.5:
                break
            take = min(need, remaining_spare[s_id])
            if take < 0.5:
                continue
            remaining_spare[s_id] -= take
            need -= take
            s_phc = store.PHC_BY_ID[s_id]
            pairings.append({
                "from_phc_id": s_id,
                "from_phc_name": s_phc["name"],
                "from_state": s_phc["state"],
                "from_district": s_phc["district"],
                "to_phc_id": d["phc_id"],
                "to_phc_name": d_phc["name"],
                "to_state": d_phc["state"],
                "to_district": d_phc["district"],
                "quantity": round(take, 1),
                "distance_km": round(dist, 1),
                "cross_state": s_phc["state"] != d_phc["state"],
            })
    return pairings


def recommend_beds(state: str | None = None) -> list[dict]:
    """Flag PHCs running above safe bed occupancy and match each to the nearest
    facility with genuine spare capacity to divert patients to."""
    deficits, surplus = [], []
    for phc in store.PHCS:
        if state and phc["state"] != state:
            continue
        total = phc["beds_total"]
        if not total:
            continue
        occ = store.BED_HISTORY[phc["id"]]["occupied"][-1]
        util = occ / total
        if util > 0.9:
            overflow = max(1, round(occ - total * 0.85))
            deficits.append({"phc_id": phc["id"], "need": overflow, "util": util})
        elif util < 0.6:
            spare = round(total * 0.8) - occ
            if spare >= 1:
                surplus.append({"phc_id": phc["id"], "spare": spare, "util": util})

    util_by_phc = {d["phc_id"]: d["util"] for d in deficits}
    out = []
    for p in _greedy_transport(deficits, surplus):
        u = util_by_phc.get(p["to_phc_id"], 0.9)
        out.append({
            **p,
            "resource": "beds",
            "patients": p.pop("quantity"),
            "overflow_utilisation_pct": round(u * 100),
            "severity": "high" if u >= 1.0 else "medium",
        })
    out.sort(key=lambda r: (-r["overflow_utilisation_pct"], -r["patients"]))
    return out[:12]


def recommend_staff(state: str | None = None) -> list[dict]:
    """Flag PHCs with a staffing shortfall (low attendance against sanctioned
    strength) and match each to the nearest facility that can lend staff."""
    deficits, surplus = [], []
    for phc in store.PHCS:
        if state and phc["state"] != state:
            continue
        sanctioned = sum(s.get("sanctioned", 0) for s in phc.get("staff", []))
        if sanctioned < 4:
            continue
        att = store.STAFF_HISTORY[phc["id"]]["attendance_pct"][-1] / 100.0
        present = sanctioned * att
        if att < 0.65:
            gap = max(1.0, sanctioned * 0.85 - present)
            deficits.append({"phc_id": phc["id"], "need": round(gap, 1), "att": att})
        elif att > 0.9 and sanctioned >= 8:
            lend = present - sanctioned * 0.85
            if lend >= 1:
                surplus.append({"phc_id": phc["id"], "spare": round(lend, 1), "att": att})

    att_by_phc = {d["phc_id"]: d["att"] for d in deficits}
    out = []
    for p in _greedy_transport(deficits, surplus):
        a = att_by_phc.get(p["to_phc_id"], 0.6)
        out.append({
            **p,
            "resource": "staff",
            "staff_fte": p.pop("quantity"),
            "recipient_attendance_pct": round(a * 100),
            "severity": "high" if a < 0.5 else "medium",
        })
    out.sort(key=lambda r: (r["recipient_attendance_pct"], -r["staff_fte"]))
    return out[:12]


def recommend_capacity(state: str | None = None) -> dict:
    """Combined non-medicine redistribution: bed overflow + staff shortages."""
    return {"beds": recommend_beds(state), "staff": recommend_staff(state)}


def recommend_all(state: str | None = None) -> list[dict]:
    out = []
    for med in store.MEDICINES:
        out.extend(recommend_for_medicine(med["name"]))
    if state:
        out = [r for r in out if r["from_state"] == state or r["to_state"] == state]
    out.sort(key=lambda r: (r["urgency"] != "critical", -r["quantity"]))
    return out


def enrich_with_explanations(recs: list[dict], lang: str = "en", max_explained: int = 8) -> list[dict]:
    """Attach AI-generated explanations to the top max_explained critical/warning recs.
    Called server-side when the ?explain=true query param is set on the redistribution endpoint.
    """
    from app.services import genai as genai_svc
    explained = 0
    for rec in recs:
        if explained >= max_explained:
            break
        if rec.get("urgency") in ("critical", "warning"):
            try:
                from_fc = forecast_medicine(rec["from_phc_id"], rec["medicine"])
                to_fc = forecast_medicine(rec["to_phc_id"], rec["medicine"])
                rec["explanation"] = genai_svc.explain_transfer(rec, from_fc, to_fc, lang)
            except Exception:
                rec["explanation"] = None
            explained += 1
    return recs
