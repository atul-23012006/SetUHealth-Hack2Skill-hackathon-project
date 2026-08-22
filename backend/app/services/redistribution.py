"""Cross-facility redistribution recommendation engine.

For each medicine, PHCs are split into deficit (critical/warning stockout
risk) and surplus (comfortably above reorder level with no near-term risk)
pools. Deficit facilities are greedily matched to the nearest surplus
facility (haversine distance), preferring in-district and in-state moves
before longer cross-state transfers, since those are cheaper/faster to
actually execute. Transfer quantity is capped by what the source can spare
and what the destination needs to clear its warning threshold.
"""
import math

from app.services.store import STOCK_HISTORY, PHC_BY_ID
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
        rec = STOCK_HISTORY[f["phc_id"]][medicine]
        spare = f["current_level"] - rec["capacity"] * MIN_SPARE_FRACTION
        if (f["days_to_stockout"] is None or f["days_to_stockout"] >= SURPLUS_MARGIN_DAYS) and spare > rec["reorder_level"] * 0.5:
            surplus.append({**f, "spare_units": round(spare, 1)})

    deficits.sort(key=lambda f: f["days_to_stockout"] if f["days_to_stockout"] is not None else 999)
    recommendations = []
    for d in deficits:
        d_phc = PHC_BY_ID[d["phc_id"]]
        needed = max(0.0, STOCK_HISTORY[d["phc_id"]][medicine]["reorder_level"] * 1.5 - d["current_level"])
        if needed <= 0 or not surplus:
            continue
        surplus.sort(key=lambda s: (
            PHC_BY_ID[s["phc_id"]]["state"] != d_phc["state"],
            PHC_BY_ID[s["phc_id"]]["district"] != d_phc["district"],
            _haversine_km(d_phc, PHC_BY_ID[s["phc_id"]]),
        ))
        donor = surplus[0]
        transfer = round(min(needed, donor["spare_units"]), 1)
        if transfer <= 0:
            continue
        donor_phc = PHC_BY_ID[donor["phc_id"]]
        recommendations.append({
            "medicine": medicine,
            "unit": d["unit"],
            "from_phc_id": donor["phc_id"],
            "from_phc_name": donor_phc["name"],
            "from_state": donor_phc["state"],
            "from_district": donor_phc["district"],
            "to_phc_id": d["phc_id"],
            "to_phc_name": d_phc["name"],
            "to_state": d_phc["state"],
            "to_district": d_phc["district"],
            "quantity": transfer,
            "distance_km": round(_haversine_km(d_phc, donor_phc), 1),
            "cross_state": donor_phc["state"] != d_phc["state"],
            "urgency": d["risk"],
        })
        donor["spare_units"] = round(donor["spare_units"] - transfer, 1)
        if donor["spare_units"] <= 0:
            surplus.remove(donor)

    return recommendations


def recommend_all(state: str | None = None) -> list[dict]:
    from app.services.store import MEDICINES
    out = []
    for med in MEDICINES:
        out.extend(recommend_for_medicine(med["name"]))
    if state:
        out = [r for r in out if r["from_state"] == state or r["to_state"] == state]
    out.sort(key=lambda r: (r["urgency"] != "critical", -r["quantity"]))
    return out
