"""Push alerts when a *real* weather signal turns high.

``check_signals()`` compares each state's current signal levels (from
``live_data.state_weather``, so real forecasts) with the level seen on the
previous check. Only a change **into "high"** notifies, so a signal that stays
high is one alert, not one per poll; it can alert again once it has dropped
out of "high" and returned. Each alert is stored (the in-app bell reads them),
written to the audit trail, and, if ``ALERT_WEBHOOK_URL`` is set, POSTed as JSON.
A failed webhook never loses the alert: it is stored with the delivery status.
"""
import asyncio
import logging
import time

import httpx
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.services import db, live_data, weather_impact

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT_S = 5.0
FIRST_POLL_DELAY_S = 20


def _post_webhook(url: str, payload: dict) -> None:
    """The single network seam for webhooks; tests replace it."""
    httpx.post(url, json=payload, timeout=WEBHOOK_TIMEOUT_S, headers={"User-Agent": live_data.USER_AGENT}).raise_for_status()


def _deliver(payload: dict) -> str:
    url = settings.alert_webhook_url
    if not url:
        return "in-app only"
    try:
        _post_webhook(url, payload)
        return "webhook delivered"
    except Exception as exc:  # any delivery problem is recorded, never raised
        logger.warning("Alert webhook failed (%s)", type(exc).__name__)
        return f"webhook failed ({type(exc).__name__})"


def _impact_sentence(state: str) -> str:
    try:
        totals = weather_impact.impact(state=state)["totals"]
    except Exception:
        return ""
    if not totals["pairs_worsened"]:
        return ""
    return (
        f" Under the planning assumptions, {totals['pairs_worsened']} facility-medicine pairs would move to a worse risk level"
        f" ({totals['new_critical']} newly critical)."
    )


def check_signals() -> list[dict]:
    """Run one check; returns the notifications it created. Raises nothing if the
    weather feed is down (it just reports no new alerts and keeps last levels)."""
    try:
        weather = live_data.state_weather()
    except live_data.LiveDataError:
        return []
    created = []
    now = time.time()
    for st in weather["states"]:
        for sig in st["signals"]:
            key = f"{st['state']}:{sig['id']}"
            previous = db.signal_state_get(key)
            became_high = sig["level"] == "high" and (previous is None or previous["level"] != "high")
            db.signal_state_put(key, sig["level"], now)
            if not became_high:
                continue
            title = f"{st['state']}: {sig['label']} is now HIGH"
            body = f"{sig['reason']}{_impact_sentence(st['state'])}"
            payload = {
                "text": f"{title}\n{body}", "title": title, "body": body,
                "state": st["state"], "signal": sig["id"], "level": "high",
                "suggested_crisis": sig.get("suggested_crisis"), "source": weather["source"],
            }
            delivery = _deliver(payload)
            nid = db.notification_add("live_signal_high", title, body, st["state"], sig["id"], "high", delivery)
            db.log_event("live_signal_high", title, {"state": st["state"], "signal": sig["id"], "delivery": delivery})
            created.append({"id": nid, "title": title, "state": st["state"], "signal": sig["id"], "delivery": delivery})
    return created


async def poll_forever() -> None:
    """Background loop started by the app's lifespan."""
    await asyncio.sleep(FIRST_POLL_DELAY_S)
    while True:
        try:
            made = await run_in_threadpool(check_signals)
            if made:
                logger.info("Created %d live-signal alert(s)", len(made))
        except Exception:
            logger.exception("Signal check failed")
        await asyncio.sleep(max(1, settings.signal_poll_minutes) * 60)
