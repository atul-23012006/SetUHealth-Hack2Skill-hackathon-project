"""In-app notifications (currently: real weather signals turning high)."""
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from app.config import settings
from app.routers.public import limiter
from app.services import db, signal_alerts

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class MarkRead(BaseModel):
    ids: list[int] | None = None  # omitted = all


@router.get("")
def list_notifications(limit: int = Query(30, ge=1, le=100), unread_only: bool = False):
    return {"items": db.notification_list(limit, unread_only), "unread": db.notification_unread_count()}


@router.post("/read")
def mark_read(body: MarkRead):
    changed = db.notification_mark_read(body.ids)
    return {"marked": changed, "unread": db.notification_unread_count()}


@router.post("/check")
@limiter.limit("6/minute")
def check_now(request: Request):
    """Run the signal check immediately instead of waiting for the poller."""
    created = signal_alerts.check_signals()
    return {"created": created, "unread": db.notification_unread_count()}


@router.get("/config")
def notification_config():
    return {
        "polling_enabled": settings.signal_polling_enabled and settings.live_data_enabled,
        "poll_minutes": settings.signal_poll_minutes,
        "webhook_configured": bool(settings.alert_webhook_url),  # never expose the URL itself
    }
