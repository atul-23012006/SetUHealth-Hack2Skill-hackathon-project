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
from app.services.forecasting import forecast_all

SURPLUS_MARGIN_DAYS = 25  # no risk before this many days => can be a donor
MIN_SPARE_FRACTION = 0.35  # keep at least this fraction of capacity as buffer


def _haversine_km(a, b) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [a["lat"], a["lon"], b["lat"], b["lon"]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def recommend_for_medicine(medicine: str) -> list[dict]:
    forecasts = [f for f in forecast_all() if f["medicine"] == medicine]
    deficits = [f for f in forecasts if f["risk"] in ("critical", "warning")]
    surplus = []
    
    for f in forecasts:
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

    # Objective: Minimize large penalty for unmet demand + transport costs
    unmet_penalty = 1000000.0
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
            cost_terms.append(cost * x[(s_idx, d_idx)])

    prob += unmet_penalty * pulp.lpSum(unmet.values()) + pulp.lpSum(cost_terms)

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
                })

    return recommendations


def recommend_all(state: str | None = None) -> list[dict]:
    out = []
    for med in store.MEDICINES:
        out.extend(recommend_for_medicine(med["name"]))
    if state:
        out = [r for r in out if r["from_state"] == state or r["to_state"] == state]
    out.sort(key=lambda r: (r["urgency"] != "critical", -r["quantity"]))
    return out
