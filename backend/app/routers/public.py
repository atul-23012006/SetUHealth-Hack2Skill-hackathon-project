"""Public transparency endpoints — read-only, no login required.

Unlike the officer-console routers, nothing here depends on
``auth.get_current_user`` or any "acting as" context: the whole point of
this router is that anyone (a journalist, an auditor, a citizen) can load
it with zero credentials. In exchange, everything it returns is restricted
to state/national-level aggregates via ``services/public_stats.py`` — see
that module's docstring for the no-PHC-identifier guarantee.

Because it has no auth to gate abuse, it carries its own rate limit
(``slowapi``), scoped to just this router.
"""
from fastapi import APIRouter, Request

from app.services import public_stats
from app.services.rate_limit import limiter

router = APIRouter(prefix="/api/public", tags=["public"])

_RATE_LIMIT = "60/minute"


@router.get("/states")
@limiter.limit(_RATE_LIMIT)
def public_states(request: Request):
    return public_stats.state_summary()


@router.get("/national")
@limiter.limit(_RATE_LIMIT)
def public_national(request: Request):
    return public_stats.national_summary()
