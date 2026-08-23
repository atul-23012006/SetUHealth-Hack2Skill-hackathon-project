from fastapi import APIRouter
from pydantic import BaseModel

from app.services import forecasting, redistribution, genai

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    query: str
    lang: str = "en"
    state: str | None = None


def _top_alerts_diverse(state: str | None, per_state_cap: int = 3, total_cap: int = 24) -> list[dict]:
    """Top alerts for the assistant's context. With no state filter, a flat
    top-N would be dominated by whichever state happens to sort first among
    ties (many facilities land on the same days-to-stockout value) - so a
    query naming a specific state could see zero of that state's real
    alerts. Capping per state instead guarantees every state is represented."""
    alerts = forecasting.network_alerts(state)
    if state:
        return alerts[:total_cap]
    per_state: dict[str, list[dict]] = {}
    diverse: list[dict] = []
    for a in alerts:
        bucket = per_state.setdefault(a["state"], [])
        if len(bucket) < per_state_cap:
            bucket.append(a)
            diverse.append(a)
        if len(diverse) >= total_cap:
            break
    return diverse


def _build_context(state: str | None) -> str:
    alerts = _top_alerts_diverse(state)
    recs = redistribution.recommend_all(state)[:10]
    lines = ["Current stockout alerts (sampled across states for coverage):"]
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
