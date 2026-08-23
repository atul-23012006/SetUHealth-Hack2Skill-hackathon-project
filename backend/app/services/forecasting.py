"""Predictive stockout modelling with statistical forecasting.

Uses Holt's Linear Exponential Smoothing (via statsmodels) to forecast future
demand based on historical daily consumption (filtering out restocking events).
Falls back to a deterministic moving average model if the available history
is too short or fitting fails. Stockout prediction is defined as the number
of days until the projected inventory breaches the safety threshold (reorder level).
"""
import numpy as np

from app.services import store

TREND_WINDOW = 14
FORECAST_HORIZON = 14
CRITICAL_DAYS = 7
WARNING_DAYS = 14
MIN_OBSERVATIONS = 14  # Minimum history length required to fit Holt's smoothing model


def check_surge(levels: list[float]) -> tuple[float, float, bool]:
    """Calculate baseline rate, recent rate, and detect if a surge occurred.
    Filters out days when the stock was already depleted to avoid diluting the active rate.
    """
    consumption = []
    for i in range(1, len(levels)):
        if levels[i - 1] > 0.05:
            diff = levels[i - 1] - levels[i]
            consumption.append(max(0.0, diff))

    if not consumption:
        return 0.0, 0.0, False

    # Split into active baseline and recent active window (last 14 active days)
    if len(consumption) <= TREND_WINDOW:
        recent_window = consumption
        baseline_window = []
    else:
        recent_window = consumption[-TREND_WINDOW:]
        baseline_window = consumption[:-TREND_WINDOW]

    baseline_rate = float(np.mean(baseline_window)) if baseline_window else 0.0
    recent_rate = float(np.mean(recent_window)) if recent_window else 0.0

    # Determine if a surge is active (recent consumption is > 1.5x baseline and significant)
    is_surge = False
    if recent_rate > 1.5:
        if baseline_rate <= 0.1 or (recent_rate / baseline_rate) > 1.5:
            is_surge = True

    return baseline_rate, recent_rate, is_surge


def forecast_medicine(phc_id: str, medicine: str) -> dict:
    record = store.STOCK_HISTORY[phc_id][medicine]
    levels = record["levels"]
    current = levels[-1]
    reorder_level = record["reorder_level"]
    capacity = record["capacity"]

    # 1. Extract historical daily consumption series (ignoring restocking jumps)
    # Note: Upward inventory movements represent restocking events, not negative consumption.
    # Decreases due to transfers or other stock adjustments are treated as consumption in this model.
    # Filter out days when stock was already depleted to avoid unobserved demand bias.
    consumption = []
    for i in range(1, len(levels)):
        if levels[i - 1] > 0.05:
            diff = levels[i - 1] - levels[i]
            consumption.append(max(0.0, diff))

    forecasted_demand = None
    forecast_method = "fallback"

    # 2. Fit Holt's Linear Exponential Smoothing if enough history exists
    if len(consumption) >= MIN_OBSERVATIONS:
        try:
            from statsmodels.tsa.holtwinters import ExponentialSmoothing
            # Holt's Linear Exponential Smoothing (trend="add", seasonal=None)
            model = ExponentialSmoothing(
                np.array(consumption, dtype=float),
                trend="add",
                seasonal=None,
                initialization_method="estimated"
            )
            fit = model.fit()
            forecasted = fit.forecast(FORECAST_HORIZON)
            
            # Clip forecasted demand to ensure no negative values are returned
            forecasted_demand = np.clip(forecasted, 0.0, None)
            forecast_method = "exponential_smoothing"
        except Exception:
            # Fallback to moving average if fitting fails (e.g. constant/zero demand or singular matrix)
            forecast_method = "fallback"

    # 3. Fallback Heuristic (Moving average)
    if forecasted_demand is None:
        # Calculate trailing 14-day average consumption from non-depleted days
        active_consumption = []
        for i in range(1, len(levels)):
            if levels[i - 1] > 0.05:
                active_consumption.append(max(0.0, levels[i - 1] - levels[i]))
        fallback_rate = float(np.mean(active_consumption[-TREND_WINDOW:])) if active_consumption else 0.0
        forecasted_demand = np.array([fallback_rate] * FORECAST_HORIZON)

    # 4. Project future inventory using the forecasted consumption
    projected_levels = []
    level = current
    for d_demand in forecasted_demand:
        level = max(0.0, level - d_demand)
        projected_levels.append(round(level, 1))

    # 5. Calculate predicted days to breach the safety threshold (reorder level)
    days_to_stockout = None
    
    # Identify the first day where projected level is at or below the safety threshold
    if current <= reorder_level:
        days_to_stockout = 0.0
    else:
        for idx, p_level in enumerate(projected_levels):
            if p_level <= reorder_level:
                days_to_stockout = float(idx + 1)
                break
        
        # If it doesn't breach within the 14-day forecast window, extrapolate using average forecasted demand
        if days_to_stockout is None:
            avg_demand = float(np.mean(forecasted_demand))
            if avg_demand > 0.01:
                days_to_stockout = round((current - reorder_level) / avg_demand, 1)

    # 6. Determine risk level relative to safety threshold breach
    if current <= 0.05:
        # Severe out of stock state
        days_to_stockout = 0.0
        risk = "critical"
    elif days_to_stockout is None:
        risk = "low"
    else:
        if days_to_stockout <= CRITICAL_DAYS:
            risk = "critical"
        elif days_to_stockout <= WARNING_DAYS:
            risk = "warning"
        else:
            risk = "low"

    # 7. Keep the existing surge-detection mechanism separately
    baseline_rate, recent_rate, surge_detected = check_surge(levels)

    return {
        "phc_id": phc_id,
        "medicine": medicine,
        "unit": record["unit"],
        "current_level": current,
        "capacity": capacity,
        "reorder_level": reorder_level,
        "daily_depletion_rate": round(float(np.mean(forecasted_demand)), 2),
        "days_to_stockout": days_to_stockout,
        "risk": risk,
        "projection": projected_levels,  # Maps to the chart's timeline expectation
        "surge_detected": surge_detected,
        "baseline_rate": round(baseline_rate, 2),
        "forecast_method": forecast_method,
        "projected_levels": projected_levels,
        "forecasted_daily_demand": [round(float(d), 2) for d in forecasted_demand],
    }


def forecast_all(state: str | None = None) -> list[dict]:
    results = []
    for phc_id, meds in store.STOCK_HISTORY.items():
        phc = store.PHC_BY_ID[phc_id]
        if state and phc["state"] != state:
            continue
        for medicine in meds:
            results.append(forecast_medicine(phc_id, medicine))
    return results


def network_alerts(state: str | None = None) -> list[dict]:
    forecasts = forecast_all(state)
    alerts = [f for f in forecasts if f["risk"] in ("critical", "warning")]
    alerts.sort(
        key=lambda f: (
            f["risk"] != "critical",
            f["days_to_stockout"] if f["days_to_stockout"] is not None else 999,
        )
    )
    for a in alerts:
        phc = store.PHC_BY_ID[a["phc_id"]]
        a["phc_name"] = phc["name"]
        a["state"] = phc["state"]
        a["district"] = phc["district"]
    return alerts
