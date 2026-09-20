from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import settings
from app.routers import (
    phc, forecast, alerts, redistribution, federated, assistant, crisis,
    transfers, fhir, anomalies, audit, auth, public, export,
)

app = FastAPI(title="SetuHealth API", description="Federated national PHC resource management platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting is scoped to the public router only (see routers/public.py) —
# it's the one router with no auth dependency, so it's the one that needs its
# own abuse protection.
app.state.limiter = public.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.include_router(phc.router)
app.include_router(forecast.router)
app.include_router(alerts.router)
app.include_router(redistribution.router)
app.include_router(federated.router)
app.include_router(assistant.router)
app.include_router(crisis.router)
app.include_router(transfers.router)
app.include_router(fhir.router)
app.include_router(anomalies.router)
app.include_router(audit.router)
app.include_router(auth.router)
app.include_router(public.router)
app.include_router(export.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
