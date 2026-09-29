"""Cross-facility redistribution recommendation engine using PuLP optimization.

For each medicine, PHCs are split into deficit (critical/warning stockout
risk) and surplus (comfortably above reorder level with no near-term risk)
pools. Deficit facilities are matched to surplus facilities by solving a
transportation optimization problem that maximizes satisfied deficit while
minimizing transport costs (distance + district/state penalties).
"""
import pulp

from app.services import store, worker_pool
from app.services.forecasting import forecast_all, forecast_medicine
from app.services.geo import haversine_km as _haversine_km

SURPLUS_MARGIN_DAYS = 25  # no risk before this many days => can be a donor
MIN_SPARE_FRACTION = 0.35  # keep at least this fraction of capacity as buffer
MAX_DONOR_LOAD = 2.0  # a facility may donate at most this many "full medicines'
# worth" of spare, summed as a fraction-of-spare across every medicine it's
# recommended to donate in one pass — see _apply_cross_medicine_donor_cap


def _facility_snapshot() -> dict[str, dict]:
    """Plain, picklable {phc_id: {name, state, district, lat, lon}} — the only
    facility fields ``_solve_medicine`` needs. Read once per ``recommend_all``
    call and handed to every worker, instead of each worker importing
    ``store`` itself (see ``_solve_medicine``'s docstring for why)."""
    return {
        pid: {"name": p["name"], "state": p["state"], "district": p["district"], "lat": p["lat"], "lon": p["lon"]}
        for pid, p in store.PHC_BY_ID.items()
    }


def _stock_meta_snapshot(medicine: str) -> dict[str, dict]:
    """{phc_id: {capacity, reorder_level}} for one resource — the only
    STOCK_HISTORY fields ``_solve_medicine`` needs, besides what's already on
    each forecast dict."""
    out = {}
    for pid, meds in store.STOCK_HISTORY.items():
        rec = meds.get(medicine)
        if rec is not None:
            out[pid] = {"capacity": rec["capacity"], "reorder_level": rec["reorder_level"]}
    return out


def _solve_medicine(
    medicine: str,
    forecasts: list[dict],
    facilities: dict[str, dict],
    stock_meta: dict[str, dict],
    tier: int,
) -> list[dict]:
    """The actual LP build-and-solve, as a free function over plain data only
    (no ``store`` import) so it can run in a worker process: ``ProcessPoolExecutor``
    pickles its arguments and re-imports this module in each worker, but that
    worker never re-loads ``store`` (which would re-read every generated JSON
    file per call) or risks seeing it mid-mutation from a transfer/crisis in
    the parent process — everything it needs arrives as an argument, snapshotted
    once by the caller. Kept at module level (not nested) because only a
    module-level function is picklable."""
    deficits = [f for f in forecasts if f["risk"] in ("critical", "warning") and not f.get("cold_chain_alert")]
    surplus = []

    for f in forecasts:
        if f.get("cold_chain_alert"):
            # If cold chain alert is active, evacuate all remaining stock before it spoils
            if f["current_level"] > 0.05:
                surplus.append({**f, "spare_units": round(f["current_level"], 1)})
        else:
            meta = stock_meta.get(f["phc_id"])
            if meta is None:
                continue
            spare = f["current_level"] - meta["capacity"] * MIN_SPARE_FRACTION
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
        meta = stock_meta[d["phc_id"]]
        needed = max(0.0, meta["reorder_level"] * 1.5 - d["current_level"])
        needed_vals[d_idx] = needed
        unmet[d_idx] = pulp.LpVariable(
            f"unmet_{d_idx}", lowBound=0, cat=pulp.LpContinuous
        )

    # Constraints:
    # 1. Total sent from surplus[s] cannot exceed its spare units
    for s_idx, s in enumerate(surplus):
        prob += pulp.lpSum(x[(s_idx, d_idx)] for d_idx in range(len(deficits))) <= s["spare_units"], f"Donor_Spare_{s_idx}"

    # 2. Total received + unmet must equal the needed amount at deficit[d]
    for d_idx, _d in enumerate(deficits):
        prob += pulp.lpSum(x[(s_idx, d_idx)] for s_idx in range(len(surplus))) + unmet[d_idx] == needed_vals[d_idx], f"Recipient_Need_{d_idx}"

    # Per-facility urgency weights prioritize critical, high-tier shortages.
    # Tier comes from the resource registry (passed in, looked up once by the
    # caller), so a non-medicine resource (blood, oxygen) is prioritised by
    # the same rule without a special case here.
    base_unmet_penalty = 100000.0
    tier_weight = {1: 3.0, 2: 2.0, 3: 1.0}[tier]

    weight = {}
    for d_idx, d in enumerate(deficits):
        risk_weight = 2.0 if d["risk"] == "critical" else 1.0
        weight[d_idx] = base_unmet_penalty * tier_weight * risk_weight

    cost_terms = []
    for s_idx, s in enumerate(surplus):
        s_phc = facilities[s["phc_id"]]
        for d_idx, d in enumerate(deficits):
            d_phc = facilities[d["phc_id"]]
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
        s_phc = facilities[s["phc_id"]]
        for d_idx, d in enumerate(deficits):
            d_phc = facilities[d["phc_id"]]
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


def recommend_for_medicine(medicine: str, forecasts: list[dict] | None = None) -> list[dict]:
    """Single-process convenience wrapper over ``_solve_medicine``, reading
    directly from live ``store`` — used by callers outside the parallel
    ``recommend_all`` path (weather scenarios, tests). ``forecasts`` lets a
    caller supply an alternative forecast set (e.g. the weather scenario in
    ``weather_impact``); by default the live forecasts are used."""
    forecasts = [f for f in (forecasts if forecasts is not None else forecast_all()) if f["medicine"] == medicine]
    resource = store.resource_type(medicine)
    tier = resource.tier if resource else 3
    return _solve_medicine(medicine, forecasts, _facility_snapshot(), _stock_meta_snapshot(medicine), tier)


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


def _donor_load_fraction(rec: dict) -> float:
    """Fraction of the donor's computed spare (for that one medicine) this
    single recommendation consumes — dimensionless and therefore comparable
    across medicines with different units (tablets, ml, sachets...), unlike
    summing raw quantities."""
    stock = store.STOCK_HISTORY.get(rec["from_phc_id"], {}).get(rec["medicine"])
    if not stock:
        return 0.0
    current_level = stock["levels"][-1]
    capacity = stock.get("capacity") or 1.0
    spare = max(current_level - capacity * MIN_SPARE_FRACTION, 0.1)
    return rec["quantity"] / spare


def _apply_cross_medicine_donor_cap(recs: list[dict]) -> list[dict]:
    """Post-hoc check across every medicine's independently-solved LP.

    ``recommend_for_medicine`` builds and solves its own LP per medicine,
    with its own ``Donor_Spare`` constraint capping how much a facility can
    give up *for that one medicine only*. Nothing stops the same facility
    being picked as a donor for several medicines at once, so summed across
    every medicine's recommendations a single facility could be asked to
    give away far more than it can safely spare in aggregate, even though
    each individual LP pass judged it safe in isolation.

    This aggregates each donor's total load (see ``_donor_load_fraction``)
    across every medicine it's recommended to donate in this pass, and if a
    facility is over ``MAX_DONOR_LOAD`` once summed, drops its
    lowest-priority (non-critical), smallest-quantity recommendations first
    until it's back under the cap. Facilities evacuating a failing cold
    chain are exempt — that's a "move it before it spoils" constraint, not a
    spare-capacity one."""
    if not recs:
        return recs

    by_phc: dict[str, list[dict]] = {}
    for r in recs:
        if r["from_phc_id"] in store.COLD_CHAIN_FAILURES:
            continue
        by_phc.setdefault(r["from_phc_id"], []).append(r)

    dropped = set()
    for _phc_id, phc_recs in by_phc.items():
        total_load = sum(_donor_load_fraction(r) for r in phc_recs)
        if total_load <= MAX_DONOR_LOAD:
            continue
        trimmable = sorted(
            (r for r in phc_recs if r["urgency"] != "critical"),
            key=lambda r: r["quantity"],
        )
        for r in trimmable:
            if total_load <= MAX_DONOR_LOAD:
                break
            total_load -= _donor_load_fraction(r)
            dropped.add(id(r))

    return [r for r in recs if id(r) not in dropped]


def recommend_all(state: str | None = None, forecasts: list[dict] | None = None) -> list[dict]:
    # Each tracked resource (not just medicines — adding one to the registry is
    # enough for it to start being redistributed) gets its own independent LP.
    # Building + solving one is roughly half CBC-subprocess-wait and half
    # genuine Python work (pulp's expression construction over ~2-3k terms per
    # medicine) — the CPU half is bound by the GIL, so a thread pool alone
    # only cut the I/O half. Running each medicine's solve in its own process
    # parallelises both halves (measured ~650ms serial -> ~150-250ms for the
    # full ~14-resource network). Workers get a plain-data snapshot rather
    # than importing `store`, so they never re-read the generated JSON files
    # per call and can't see it mid-mutation from a transfer/crisis in this
    # process — see `_solve_medicine`'s docstring.
    if forecasts is None:
        forecasts = forecast_all()
    resource_keys = store.resource_stock_keys()
    facilities = _facility_snapshot()
    forecasts_by_resource = {rk: [f for f in forecasts if f["medicine"] == rk] for rk in resource_keys}
    stock_meta_by_resource = {rk: _stock_meta_snapshot(rk) for rk in resource_keys}
    tier_by_resource = {rk: (store.resource_type(rk).tier if store.resource_type(rk) else 3) for rk in resource_keys}

    futures = worker_pool.map_unordered(
        _solve_medicine,
        [(rk, forecasts_by_resource[rk], facilities, stock_meta_by_resource[rk], tier_by_resource[rk]) for rk in resource_keys],
    )
    out = [r for fut in futures for r in fut.result()]
    out = _apply_cross_medicine_donor_cap(out)
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
