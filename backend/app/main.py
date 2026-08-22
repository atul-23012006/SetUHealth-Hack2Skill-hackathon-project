from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import phc, forecast, alerts, redistribution, federated, assistant

app = FastAPI(title="SetuHealth API", description="Federated national PHC resource management platform")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(phc.router)
app.include_router(forecast.router)
app.include_router(alerts.router)
app.include_router(redistribution.router)
app.include_router(federated.router)
app.include_router(assistant.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
