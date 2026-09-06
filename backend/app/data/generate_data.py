"""Generates a realistic synthetic dataset for the national PHC network:
facility roster, 90 days of medicine stock history, bed occupancy, and staff
attendance. Deterministic (seed=42) so the demo is stable across restarts.

Run directly to (re)build the JSON files under app/data/generated/.
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

# Trailing window (days) over which a handful of facilities are given a
# deliberate consumption-vs-footfall inconsistency, so the anomaly detector
# (app/services/anomaly.py) has real signal to surface in a demo.
ANOMALY_WINDOW = 21
N_ANOMALIES = 6

from app.data.reference import STATES, MEDICINES, STAFF_ROLES, REAL_PHC_COUNTS, REAL_CONSUMPTION_ANCHORS

SEED = 42
DAYS = 90
OUT_DIR = Path(__file__).parent / "generated"

# The demo runs at 1/10th the real district-level PHC count (see
# REAL_PHC_COUNTS in reference.py, sourced from official Rural Health
# Statistics) so the map stays legible and forecasting/redistribution stay
# fast for a live demo. Facility counts are still proportional to the real
# district data, not uniform - the architecture scales linearly to the full
# real counts (and beyond) in production.
SCALE_FACTOR = 0.1
MIN_PHCS_PER_DISTRICT = 3

DISTRICT_CENTERS = {
    "Pune": (18.52, 73.85), "Nagpur": (21.15, 79.09), "Nashik": (20.00, 73.79), "Aurangabad": (19.88, 75.34),
    "Lucknow": (26.85, 80.95), "Varanasi": (25.32, 83.01), "Meerut": (28.98, 77.71), "Gorakhpur": (26.76, 83.37),
    "Patna": (25.59, 85.14), "Gaya": (24.80, 85.00), "Muzaffarpur": (26.12, 85.39), "Bhagalpur": (25.24, 86.98),
    "Jaipur": (26.91, 75.79), "Jodhpur": (26.28, 73.02), "Udaipur": (24.58, 73.68), "Bikaner": (28.02, 73.31),
    "Coimbatore": (11.02, 76.96), "Madurai": (9.93, 78.12), "Salem": (11.66, 78.15), "Tiruchirappalli": (10.79, 78.70),
    "Thiruvananthapuram": (8.52, 76.94), "Kochi": (9.93, 76.26), "Kozhikode": (11.26, 75.78), "Thrissur": (10.53, 76.21),
}

SEASON_BY_MONTH = {
    1: "winter", 2: "winter", 3: "spring", 4: "summer", 5: "summer", 6: "monsoon",
    7: "monsoon", 8: "monsoon", 9: "monsoon", 10: "autumn", 11: "autumn", 12: "winter",
}


def build():
    rng = random.Random(SEED)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    phcs = []
    phc_id = 1
    for state, districts in STATES.items():
        for district in districts:
            n_phc = max(MIN_PHCS_PER_DISTRICT, round(REAL_PHC_COUNTS[district] * SCALE_FACTOR))
            clat, clon = DISTRICT_CENTERS[district]
            for i in range(n_phc):
                beds = rng.choice([6, 10, 15, 20, 30])
                staff = []
                for role in STAFF_ROLES:
                    count = {"Medical Officer": rng.randint(1, 2), "Staff Nurse": rng.randint(2, 5),
                             "ASHA Worker": rng.randint(3, 8), "Pharmacist": rng.randint(1, 2),
                             "Lab Technician": rng.randint(1, 2)}[role]
                    staff.append({"role": role, "sanctioned": count})
                # deliberately stress a subset of PHCs so forecasting/redistribution has signal
                stress = rng.random() < 0.28
                surplus_bias = rng.random() < 0.22 and not stress
                phcs.append({
                    "id": f"PHC-{phc_id:04d}",
                    "name": f"{district} PHC {i + 1}",
                    "state": state,
                    "district": district,
                    "lat": round(clat + rng.uniform(-0.35, 0.35), 4),
                    "lon": round(clon + rng.uniform(-0.35, 0.35), 4),
                    "beds_total": beds,
                    "staff": staff,
                    "_stress": stress,
                    "_surplus_bias": surplus_bias,
                })
                phc_id += 1

    start = date.today() - timedelta(days=DAYS - 1)
    all_dates = [(start + timedelta(days=d)).isoformat() for d in range(DAYS)]

    stock_history = {}   # phc_id -> medicine -> {dates, levels, capacity, reorder_level}
    bed_history = {}      # phc_id -> {dates, occupied}
    staff_history = {}    # phc_id -> {dates, attendance_pct}
    footfall_history = {}  # phc_id -> {visits}  (daily OPD patient visits)

    for phc in phcs:
        pid = phc["id"]
        stress = phc.pop("_stress")
        surplus_bias = phc.pop("_surplus_bias")

        # --- medicine stock ---
        stock_history[pid] = {}
        for med in MEDICINES:
            # Use real-world grounded consumption anchors (NHSRC DLMIS / WHO India)
            # with Gaussian noise around the published mean — clipped to a positive minimum.
            anchor = REAL_CONSUMPTION_ANCHORS.get(med["name"], {"mean": 5.0, "std": 1.5})
            base_daily_use = max(0.3, rng.gauss(anchor["mean"], anchor["std"]))
            capacity = round(base_daily_use * rng.uniform(25, 45))
            reorder_level = round(capacity * 0.25)
            level = capacity * rng.uniform(0.5, 0.95)
            levels = []
            restock_cycle = rng.randint(12, 21)
            days_since_restock = rng.randint(0, restock_cycle)
            for idx, d_iso in enumerate(all_dates):
                month = int(d_iso[5:7])
                season = SEASON_BY_MONTH[month]
                seasonal_mult = 1.6 if med["seasonal"] == season else 1.0
                stress_mult = 1.35 if stress else (0.75 if surplus_bias else 1.0)
                daily_use = base_daily_use * seasonal_mult * stress_mult * rng.uniform(0.8, 1.2)
                level = max(0.0, level - daily_use)
                days_since_restock += 1
                # restocks are less reliable for "stressed" PHCs -> realistic stockout risk
                restock_chance = 0.15 if not stress else 0.05
                if days_since_restock >= restock_cycle or rng.random() < restock_chance:
                    if not (stress and rng.random() < 0.4):  # stressed PHCs sometimes miss resupply
                        level = min(capacity, level + capacity * rng.uniform(0.5, 1.0))
                        days_since_restock = 0
                levels.append(round(level, 1))
            stock_history[pid][med["name"]] = {
                "unit": med["unit"], "category": med["category"],
                "capacity": capacity, "reorder_level": reorder_level,
                "levels": levels,
            }

        # --- bed occupancy ---
        base_occ = rng.uniform(0.4, 0.75) * (1.2 if stress else 1.0)
        occ = []
        for d_iso in all_dates:
            val = min(phc["beds_total"], max(0, round(phc["beds_total"] * min(1.0, base_occ + rng.uniform(-0.15, 0.2)))))
            occ.append(val)
        bed_history[pid] = {"occupied": occ}

        # --- staff attendance ---
        base_att = rng.uniform(0.78, 0.97) * (0.85 if stress else 1.0)
        att = []
        for d_iso in all_dates:
            val = min(100, max(30, round((base_att + rng.uniform(-0.1, 0.08)) * 100)))
            att.append(val)
        staff_history[pid] = {"attendance_pct": att}

        # --- OPD footfall (daily patient visits) ---
        # Loosely scales with facility size; underserved (stressed) PHCs draw a
        # larger catchment, "surplus" PHCs a lighter one. Weekends dip sharply,
        # monsoon/summer lift OPD load. This is the independent patient-volume
        # signal the anomaly detector reconciles medicine consumption against.
        base_opd = max(6.0, rng.gauss(9.0 + phc["beds_total"] * 0.9, 5.0))
        opd_stress_mult = 1.15 if stress else (0.9 if surplus_bias else 1.0)
        visits = []
        for d_iso in all_dates:
            month = int(d_iso[5:7])
            season = SEASON_BY_MONTH[month]
            seasonal_opd = 1.25 if season in ("monsoon", "summer") else 1.0
            weekday = date.fromisoformat(d_iso).weekday()  # Mon=0 .. Sun=6
            weekday_mult = 0.3 if weekday == 6 else (0.65 if weekday == 5 else 1.0)
            val = base_opd * opd_stress_mult * seasonal_opd * weekday_mult * rng.uniform(0.8, 1.2)
            visits.append(max(0, round(val)))
        footfall_history[pid] = {"visits": visits}

    # --- inject deterministic consumption anomalies -----------------------------
    # A few facilities get a trailing-window inconsistency between recorded
    # medicine consumption and patient footfall: "pilferage" burns stock far
    # faster than visits justify; "underreport" shows almost no book movement
    # despite steady OPD load (data-entry failure or diversion). The detector
    # in anomaly.py rediscovers these from the ratio distribution alone.
    n_days = len(all_dates)
    w0 = max(0, n_days - ANOMALY_WINDOW)
    anomaly_candidates = [p["id"] for p in phcs]
    rng.shuffle(anomaly_candidates)
    high_volume_meds = [
        "Paracetamol 500mg", "ORS Sachets", "Amoxicillin 500mg",
        "Iron Folic Acid Tablets", "Metformin 500mg",
    ]
    anomaly_flags = {}
    for i, pid in enumerate(anomaly_candidates[:N_ANOMALIES]):
        atype = "pilferage" if i % 2 == 0 else "underreport"
        meds_hit = [m for m in high_volume_meds if m in stock_history[pid]][:2]
        if not meds_hit:
            continue
        for med in meds_hit:
            rec = stock_history[pid][med]
            levels = rec["levels"]
            cap = rec["capacity"]
            rebuilt = [levels[w0]]
            for idx in range(w0 + 1, n_days):
                delta = levels[idx] - levels[idx - 1]  # <0 consumption, >0 restock
                if delta < 0:
                    delta *= 2.4 if atype == "pilferage" else 0.3
                val = min(cap, max(0.0, rebuilt[-1] + delta))
                rebuilt.append(round(val, 1))
            levels[w0:] = rebuilt
        anomaly_flags[pid] = {
            "type": atype,
            "medicines": meds_hit,
            "since": all_dates[w0],
        }

    (OUT_DIR / "dates.json").write_text(json.dumps(all_dates))
    (OUT_DIR / "phcs.json").write_text(json.dumps(phcs, indent=2))
    (OUT_DIR / "stock_history.json").write_text(json.dumps(stock_history))
    (OUT_DIR / "bed_history.json").write_text(json.dumps(bed_history))
    (OUT_DIR / "staff_history.json").write_text(json.dumps(staff_history))
    (OUT_DIR / "footfall_history.json").write_text(json.dumps(footfall_history))
    (OUT_DIR / "anomaly_flags.json").write_text(json.dumps(anomaly_flags, indent=2))
    (OUT_DIR / "medicines.json").write_text(json.dumps(MEDICINES, indent=2))
    print(
        f"Generated {len(phcs)} PHCs across {len(STATES)} states, {DAYS} days of history "
        f"(facility counts scaled {SCALE_FACTOR:.0%} of real district-level RHS PHC counts) -> {OUT_DIR}"
    )
    print(
        f"Injected {len(anomaly_flags)} consumption-vs-footfall anomalies over the "
        f"trailing {ANOMALY_WINDOW} days for the anomaly detector to surface."
    )
    print(
        "Consumption anchors grounded in: NHSRC DLMIS 2022-23, WHO/UNICEF India PHC "
        "Essential Medicines benchmarks, ICMR NCD Survey 2023, NVBDCP DLMIS 2022."
    )


if __name__ == "__main__":
    build()
