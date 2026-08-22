"""Predictive stockout modelling.

Approach (kept intentionally simple + explainable for a hackathon demo, but
sound): estimate the recent net daily depletion rate per PHC/medicine from
the trailing window of the time series (ignoring restock jumps), project the
current stock forward, and derive a days-to-stockout estimate. This is the
same idea a production system would extend with a proper time-series model
(e.g. Prophet / a per-facility ARIMA) once real telemetry is available -
the API contract here is designed so that swap is transparent to the frontend.
"""
import numpy as np

from app.services.store import STOCK_HISTORY, PHC_BY_ID, MEDICINES, DATES

TREND_WINDOW = 14
FORECAST_HORIZON = 14
CRITICAL_DAYS = 7
WARNING_DAYS = 14


def _daily_deltas(levels: list[float]) -> np.ndarray:
    arr = np.array(levels[-TREND_WINDOW:], dtype=float)
    return np.diff(arr)


def estimate_depletion_rate(levels: list[float]) -> float:
    deltas = _daily_deltas(levels)
    consumption = -deltas[deltas < 0]
    if consumption.size == 0:
        return 0.0
    return float(np.mean(consumption))


def forecast_medicine(phc_id: str, medicine: str) -> dict:
    record = STOCK_HISTORY[phc_id][medicine]
    levels = record["levels"]
    current = levels[-1]
    rate = estimate_depletion_rate(levels)
    reorder_level = record["reorder_level"]
    capacity = record["capacity"]

    if rate <= 0.01:
        days_to_stockout = None
        risk = "low"
    else:
        days_to_stockout = round(current / rate, 1)
        if days_to_stockout <= CRITICAL_DAYS:
            risk = "critical"
        elif days_to_stockout <= WARNING_DAYS:
            risk = "warning"
        else:
            risk = "low"

    projection = []
    level = current
    for _ in range(FORECAST_HORIZON):
        level = max(0.0, level - rate)
        projection.append(round(level, 1))

    return {
        "phc_id": phc_id,
        "medicine": medicine,
        "unit": record["unit"],
        "current_level": current,
        "capacity": capacity,
        "reorder_level": reorder_level,
        "daily_depletion_rate": round(rate, 2),
        "days_to_stockout": days_to_stockout,
        "risk": risk,
        "projection": projection,
    }


def forecast_all(state: str | None = None) -> list[dict]:
    results = []
    for phc_id, meds in STOCK_HISTORY.items():
        phc = PHC_BY_ID[phc_id]
        if state and phc["state"] != state:
            continue
        for medicine in meds:
            results.append(forecast_medicine(phc_id, medicine))
    return results


def network_alerts(state: str | None = None) -> list[dict]:
    forecasts = forecast_all(state)
    alerts = [f for f in forecasts if f["risk"] in ("critical", "warning")]
    alerts.sort(key=lambda f: (f["risk"] != "critical", f["days_to_stockout"] if f["days_to_stockout"] is not None else 999))
    for a in alerts:
        phc = PHC_BY_ID[a["phc_id"]]
        a["phc_name"] = phc["name"]
        a["state"] = phc["state"]
        a["district"] = phc["district"]
    return alerts
