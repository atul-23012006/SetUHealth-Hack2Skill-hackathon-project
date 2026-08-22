from fastapi import APIRouter
from pydantic import BaseModel

from app.services import forecasting, redistribution, genai

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    query: str
    lang: str = "en"
    state: str | None = None


def _build_context(state: str | None) -> str:
    alerts = forecasting.network_alerts(state)[:10]
    recs = redistribution.recommend_all(state)[:10]
    lines = ["Top current stockout alerts:"]
    for a in alerts:
        lines.append(
            f"- {a['phc_name']} ({a['district']}, {a['state']}): {a['medicine']} "
            f"~{a['days_to_stockout']} days left [{a['risk']}]"
        )
    lines.append("Top redistribution recommendations:")
    for r in recs:
        lines.append(
            f"- Move {r['quantity']} {r['unit']} of {r['medicine']} from {r['from_phc_name']} "
            f"({r['from_state']}) to {r['to_phc_name']} ({r['to_state']}), {r['distance_km']} km"
        )
    return "\n".join(lines)


@router.post("/chat")
def chat(req: ChatRequest):
    context = _build_context(req.state)
    reply = genai.chat_reply(req.query, context, req.lang)
    return {"reply": reply}
