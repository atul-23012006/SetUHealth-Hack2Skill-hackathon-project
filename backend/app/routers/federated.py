from fastapi import APIRouter

from app.services import federated

router = APIRouter(prefix="/api/federated", tags=["federated"])


@router.get("/national")
def national():
    return federated.national_federated_prior()


@router.get("/brics")
def brics():
    return federated.brics_shared_prior()
