import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.services.rate_limit import limiter
from app.routers import (
    alerts,
    anomalies,
    assistant,
    audit,
    auth,
    crisis,
    export,
    federated,
    fhir,
    forecast,
    live,
    notifications,
    phc,
    public,
    redistribution,
    transfers,
)
from app.services import auth as auth_service
from app.services import forecasting, signal_alerts, worker_pool

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Warm the shared solver/forecast pool (services/worker_pool.py) now, not
    # on the first request: its workers are separate processes that each
    # re-import the app (reloading the generated dataset) before they can do
    # anything, which would otherwise land on whichever user's request
    # happens to be first. Then run the national forecast once — the single
    # most expensive uncached call in the app (~1.9k Holt's-smoothing fits) —
    # so it's already cached by the time any request needs it, and dispatches
    # across the now-warm workers rather than paying process-spawn too. Off
    # the event loop thread since both block for the full warmup.
    await asyncio.to_thread(worker_pool.warm_pool)
    await asyncio.to_thread(forecasting.forecast_all)

    # Background check for real weather signals turning high (see services/signal_alerts.py).
    poller = None
    if settings.signal_polling_enabled and settings.live_data_enabled:
        poller = asyncio.create_task(signal_alerts.poll_forever())

    if not auth_service.token_mode():
        # Loud on purpose: demo mode has no real authentication at all (see
        # services/auth.py) — every console route, including crisis trigger/
        # reset and transfer execution, is reachable by anyone who can reach
        # this process. Fine for a local/offline demo; never for a public
        # deployment. Set AUTH_MODE=token (+ JWT_SECRET, and real per-user
        # passwords via `python -m app.scripts.manage_users set-password`)
        # before exposing this process to anything but localhost.
        logger.warning(
            "*** AUTH_MODE=demo: every console API route is UNAUTHENTICATED. "
            "Do not expose this process to the public internet in this mode. "
            "Set AUTH_MODE=token for a live deployment. ***"
        )
    if settings.cors_origins == ["*"]:
        logger.warning(
            "*** CORS_ORIGINS is unset (defaulting to '*'): any website can call this API "
            "from a browser. Set CORS_ORIGINS to your real frontend origin(s) for a live deployment. ***"
        )

    yield
    if poller:
        poller.cancel()
    # Shut down the shared solver/forecast pool so worker processes don't
    # outlive a graceful stop/reload.
    worker_pool.shutdown_pool()


app = FastAPI(
    title="SetuHealth API",
    description="Federated national PHC resource management platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Every request carries its auth (if any) as a header — Authorization:
    # Bearer in token mode, X-User-Id in demo mode — never a cookie (nothing
    # in this app ever calls set_cookie), so browser "credentials" (cookies /
    # HTTP auth) are never in play and don't need CORS's credentials flag.
    # Leaving this on would additionally make wildcard origins dangerous:
    # Starlette answers a credentialed wildcard request by reflecting the
    # caller's Origin instead of "*", which defeats the wildcard's own point.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared across every router (see services/rate_limit.py) so the officer
# console has baseline abuse protection too, not just the public router —
# essential in demo auth mode, where require_console_access is a no-op.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Console routers need a signed-in session in token mode (a no-op in demo mode).
# Open on purpose: /api/public (aggregate-only), /api/auth (login), /api/live
# (public data, rate limited), /api/export (documented integration endpoints)
# and /api/health.
_console = [Depends(auth_service.require_console_access)]
for _router in (phc, forecast, alerts, redistribution, federated, assistant, crisis, transfers, fhir, anomalies, audit, notifications):
    app.include_router(_router.router, dependencies=_console)
app.include_router(auth.router)
app.include_router(public.router)
app.include_router(export.router)
app.include_router(live.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
