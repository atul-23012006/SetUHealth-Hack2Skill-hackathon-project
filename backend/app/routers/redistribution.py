from fastapi import APIRouter

from app.services import redistribution

router = APIRouter(prefix="/api/redistribution", tags=["redistribution"])


@router.get("")
def get_recommendations(state: str | None = None):
    return redistribution.recommend_all(state)
