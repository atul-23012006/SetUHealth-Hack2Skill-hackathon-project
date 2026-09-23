"""What the real weather forecast could do to stock, as a scenario overlay.

This never changes stored data or the baseline forecast. It takes the live
weather signals (``live_data.state_weather``), applies a small table of
*planning assumptions* that raise expected demand for specific medicines in the
affected states, and re-runs the same stockout/risk rules on the result
(``forecasting.days_to_stockout_from_demand`` / ``risk_for``).

The multipliers in ``RULES`` are assumptions, not epidemiological estimates:
they exist so a planner can ask "if this weather turns into demand, where do we
run short first?". They are returned with every response, an ``intensity``
control scales them, and nothing is presented as a measured outcome.
"""
from app.services import forecasting, live_data, redistribution, store

# signal id -> medicine -> {level: demand multiplier}, with the reasoning shown to users.
RULES: dict[str, dict[str, dict]] = {
    "flood": {
        "ORS Sachets": {"elevated": 1.4, "high": 2.0, "why": "Flooding drives water-borne diarrhoeal disease."},
        "Cotrimoxazole Syrup": {"elevated": 1.3, "high": 1.7, "why": "Water-borne and respiratory infections rise after flooding."},
        "Amoxicillin 500mg": {"elevated": 1.15, "high": 1.4, "why": "Wound and respiratory infections rise after flooding."},
        "Chlorhexidine Solution": {"elevated": 1.2, "high": 1.5, "why": "More injuries and wound care during and after floods."},
    },
    "vector": {
        "Artesunate Injection": {"elevated": 1.5, "high": 2.2, "why": "Warm, wet, humid weeks favour mosquito breeding and malaria cases."},
        "Paracetamol 500mg": {"elevated": 1.2, "high": 1.5, "why": "Fever from dengue and malaria raises paracetamol use."},
    },
    "heat": {
        "ORS Sachets": {"elevated": 1.25, "high": 1.6, "why": "Heat raises dehydration and heat-illness cases."},
    },
}

_RANK = {"low": 0, "warning": 1, "critical": 2}


def _scaled(factor: float, intensity: float) -> float:
    """Intensity scales only the *excess* over 1.0, so 0 means no effect."""
    return 1.0 + (factor - 1.0) * intensity


def state_factors(intensity: float = 1.0) -> dict[str, dict[str, dict]]:
    """state -> medicine -> {"factor": float, "causes": [signal ids], "whys": [...]}.
    Where several signals hit one medicine the *largest* factor wins (they are
    not compounded: that would double-count the same demand)."""
    out: dict[str, dict[str, dict]] = {}
    for st in live_data.state_weather()["states"]:
        for sig in st["signals"]:
            if sig["level"] == "normal":
                continue
            for medicine, rule in RULES.get(sig["id"], {}).items():
                f = _scaled(rule[sig["level"]], intensity)
                if f <= 1.0:
                    continue
                slot = out.setdefault(st["state"], {}).setdefault(medicine, {"factor": 1.0, "causes": [], "whys": []})
                slot["causes"].append({"signal": sig["id"], "level": sig["level"], "label": sig["label"]})
                slot["whys"].append(rule["why"])
                slot["factor"] = max(slot["factor"], f)
    return out


def adjusted_forecasts(state: str | None = None, intensity: float = 1.0) -> list[dict]:
    """Every forecast, with weather-affected ones re-evaluated under the
    scenario. Unaffected forecasts are returned exactly as stored. Adjusted ones
    carry ``weather_adjusted``, ``weather_factor``, ``weather_causes`` and the
    baseline values, and can never look *better* than the baseline."""
    factors = state_factors(intensity)
    out = []
    for fc in forecasting.forecast_all(state):
        hit = factors.get(fc["state"], {}).get(fc["medicine"])
        if not hit:
            out.append(fc)
            continue
        demand = [d * hit["factor"] for d in fc["forecasted_daily_demand"]]
        days = forecasting.days_to_stockout_from_demand(fc["current_level"], fc["reorder_level"], demand)
        base = fc["days_to_stockout"]
        if days is not None and base is not None:
            days = min(days, base)  # demand only rises in a scenario; rounding must not make stock look healthier
        elif days is None:
            days = base
        elif base is None:
            pass  # scenario introduces a stockout the baseline didn't have
        risk = forecasting.risk_for(fc["current_level"], days)
        if _RANK[risk] < _RANK[fc["risk"]]:
            risk = fc["risk"]
        out.append({
            **fc,
            "days_to_stockout": days,
            "risk": risk,
            "daily_depletion_rate": round(fc["daily_depletion_rate"] * hit["factor"], 2),
            "weather_adjusted": True,
            "weather_factor": round(hit["factor"], 2),
            "weather_causes": hit["causes"],
            "baseline_days_to_stockout": base,
            "baseline_risk": fc["risk"],
        })
    return out


def _worsened(f: dict) -> bool:
    return bool(f.get("weather_adjusted")) and _RANK[f["risk"]] > _RANK[f["baseline_risk"]]


def alerts(state: str | None = None, intensity: float = 1.0) -> list[dict]:
    """Alerts under the scenario. What the weather *changed* comes first: with
    hundreds of facilities already critical, sorting purely by urgency would bury
    exactly the pairs the operator switched the scenario on to see."""
    adjusted = adjusted_forecasts(state, intensity)
    found = [f for f in adjusted if f["risk"] in ("critical", "warning")]
    found.sort(key=lambda f: (
        not _worsened(f),
        f["risk"] != "critical",
        f["days_to_stockout"] if f["days_to_stockout"] is not None else 999,
    ))
    return found


def recommendations(state: str | None = None, intensity: float = 1.0) -> list[dict]:
    """Redistribution recommendations computed over the adjusted forecasts."""
    return redistribution.recommend_all(state, forecasts=adjusted_forecasts(None, intensity))


def impact(state: str | None = None, intensity: float = 1.0, limit: int = 40) -> dict:
    """Summary + the facility/medicine pairs the weather makes worse."""
    factors = state_factors(intensity)
    weather = live_data.state_weather()
    adjusted = adjusted_forecasts(state, intensity)
    affected = [f for f in adjusted if f.get("weather_adjusted")]
    worsened = [f for f in affected if _RANK[f["risk"]] > _RANK[f["baseline_risk"]]]
    worsened.sort(key=lambda f: (f["risk"] != "critical", f["days_to_stockout"] if f["days_to_stockout"] is not None else 999))

    by_state = []
    for st in weather["states"]:
        if state and st["state"] != state:
            continue
        rows = [f for f in affected if f["state"] == st["state"]]
        by_state.append({
            "state": st["state"],
            "level": st["level"],
            "active_signals": [s["label"] + ": " + s["level"] for s in st["signals"] if s["level"] != "normal"],
            "medicines_affected": sorted(factors.get(st["state"], {})),
            "pairs_affected": len(rows),
            "pairs_worsened": sum(1 for f in rows if _RANK[f["risk"]] > _RANK[f["baseline_risk"]]),
            "new_critical": sum(1 for f in rows if f["risk"] == "critical" and f["baseline_risk"] != "critical"),
        })

    # Heat is a spoilage risk for perishable stock, not a demand effect, so it is
    # reported as exposure rather than folded into days-to-stockout.
    hot_states = {st["state"] for st in weather["states"] if any(s["id"] == "heat" and s["level"] != "normal" for s in st["signals"])}
    cold_chain = sum(
        1 for f in forecasting.forecast_all(state)
        if f["state"] in hot_states and (store.resource_type(f["medicine"]) and store.resource_type(f["medicine"]).is_perishable)
    )

    return {
        "source": weather["source"],
        "fetched_at": weather["fetched_at"],
        "stale": weather["stale"],
        "intensity": intensity,
        "disclaimer": "Planning assumptions applied to a real weather forecast, not measured demand. Nothing here changes stored data.",
        "assumptions": [
            {"signal": sig, "medicine": med, "elevated": r["elevated"], "high": r["high"], "why": r["why"]}
            for sig, meds in RULES.items() for med, r in meds.items()
        ],
        "states": by_state,
        "totals": {
            "pairs_affected": len(affected),
            "pairs_worsened": len(worsened),
            "new_critical": sum(1 for f in worsened if f["risk"] == "critical"),
            "cold_chain_items_exposed_to_heat": cold_chain,
        },
        "items": [
            {
                "phc_id": f["phc_id"], "phc_name": f["phc_name"], "state": f["state"], "district": f["district"],
                "medicine": f["medicine"], "unit": f["unit"], "current_level": f["current_level"],
                "factor": f["weather_factor"], "causes": f["weather_causes"],
                "days_before": f["baseline_days_to_stockout"], "days_after": f["days_to_stockout"],
                "risk_before": f["baseline_risk"], "risk_after": f["risk"],
            }
            for f in worsened[:limit]
        ],
    }
