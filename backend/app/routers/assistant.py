import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services import auth, db, forecasting, genai, live_data, redistribution

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


def _build_context(state: str | None) -> tuple[str, list[dict]]:
    """Returns the prompt text and the (phc_id, phc_name) pairs it was built
    from — the second is never sent to the model, only used afterward by
    _related_facilities to find which of these the reply actually named."""
    alerts = _top_alerts_diverse(state)
    recs = redistribution.recommend_all(state)[:10]
    facilities = [{"phc_id": a["phc_id"], "phc_name": a["phc_name"]} for a in alerts]
    facilities += [{"phc_id": r["from_phc_id"], "phc_name": r["from_phc_name"]} for r in recs]
    facilities += [{"phc_id": r["to_phc_id"], "phc_name": r["to_phc_name"]} for r in recs]

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
    # Real weather (Open-Meteo), so questions like "should Bihar prepare for
    # floods?" are answered from an actual forecast. Best effort: omitted when
    # the feed is unavailable.
    weather = live_data.weather_context_lines(state)
    if weather:
        lines.append("Real weather forecast by state (Open-Meteo, next 7 days):")
        lines.extend(weather)
    return "\n".join(lines), facilities


def _related_facilities(reply: str, query: str, facilities: list[dict], limit: int = 5) -> list[dict]:
    """Facilities from the context the reply (or the question itself, e.g.
    "what about Pune PHC 3?") actually named, in the order first mentioned —
    not just the top of whatever was fed into the prompt. A plain-text
    fabricated or misremembered facility name can never match here, since
    matching is against phc_name strings this service itself produced, not
    against anything the model invented. De-duplicated by phc_id."""
    haystack = f"{query}\n{reply}"
    seen: set[str] = set()
    out: list[dict] = []
    for f in facilities:
        if f["phc_id"] in seen:
            continue
        if f["phc_name"] and f["phc_name"] in haystack:
            seen.add(f["phc_id"])
            out.append(f)
            if len(out) >= limit:
                break
    return out


def execute_action(action: dict, user: dict | None = None) -> str:
    from app.services import store, transfers

    act_type = action.get("action")
    if act_type == "reset":
        store.reset_store_data()
        return "🔄 [SYSTEM ACTION] Database and simulation metrics have been successfully reset to baseline."

    elif act_type == "transfer":
        from_id = action.get("from_phc_id")
        to_id = action.get("to_phc_id")
        med = action.get("medicine")
        qty = action.get("quantity")
        try:
            # Same authorization gate as the manual transfer form
            # (routers/transfers.py) — the assistant is a second front door
            # onto the exact same create_and_execute_transfer call, so it
            # gets the exact same check, not a weaker one.
            auth.authorize_transfer(user, from_id)
            manifest = transfers.create_and_execute_transfer(
                from_id, to_id, med, qty,
                requested_by=user["user_id"] if user else None,
            )
            return f"✅ [SYSTEM ACTION] Transfer request {manifest['id']} executed: moved {qty} {manifest['unit']} of {med} from {manifest['from_phc_name']} to {manifest['to_phc_name']}."
        except auth.TransferNotAuthorized as e:
            db.log_event(
                "transfer_rejected",
                f"assistant denied: {e}",
                {"from_phc_id": from_id, "to_phc_id": to_id, "medicine": med, "quantity": qty,
                 "user_id": user["user_id"] if user else None},
                from_phc_id=from_id,
                to_phc_id=to_id,
            )
            return f"🚫 [SYSTEM ACTION] Transfer denied: {e}."
        except Exception as e:
            return f"❌ [SYSTEM ACTION] Transfer failed: {str(e)}."

    elif act_type == "crisis":
        t_type = action.get("target_type")
        t_name = action.get("target_name")
        c_type = action.get("crisis_type")
        try:
            store.trigger_crisis(t_type, t_name, c_type)
            return f"🚨 [SYSTEM ACTION] Alert! Crisis simulation '{c_type}' triggered successfully for {t_type} '{t_name}'."
        except Exception as e:
            return f"❌ [SYSTEM ACTION] Crisis trigger failed: {str(e)}."

    return ""


def _prepare(req: ChatRequest, user: dict | None) -> tuple[str, str, list[dict]]:
    """Run any action the message asks for; return (action feedback, data
    context, facilities the context was built from — for _related_facilities
    to match the reply against once it's known)."""
    action = genai.parse_chat_action(req.query)
    feedback = ""
    if action and action.get("action") != "none":
        feedback = execute_action(action, user)
    context, facilities = _build_context(req.state)
    return feedback, context, facilities


@router.post("/chat")
def chat(req: ChatRequest, user: dict | None = Depends(auth.get_current_user_optional)):
    feedback, context, facilities = _prepare(req, user)
    reply = genai.chat_reply(req.query, context, req.lang)
    related = _related_facilities(reply, req.query, facilities)

    if feedback:
        reply = f"{feedback}\n\n{reply}"

    return {"reply": reply, "related": related}


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post("/chat/stream")
def chat_stream(req: ChatRequest, user: dict | None = Depends(auth.get_current_user_optional)):
    """Same as /chat but streamed as server-sent events: ``{"delta": "..."}``
    chunks, then a ``{"related": [...]}`` event once the full reply is known
    (link-matching needs the complete text, not a partial chunk), then
    ``{"done": true}``. Any action feedback is sent first."""
    feedback, context, facilities = _prepare(req, user)

    def events():
        if feedback:
            yield _sse({"delta": f"{feedback}\n\n"})
        full_reply = ""
        try:
            for chunk in genai.chat_reply_stream(req.query, context, req.lang):
                full_reply += chunk
                yield _sse({"delta": chunk})
        except Exception:
            yield _sse({"error": "The assistant could not finish this answer."})
        related = _related_facilities(full_reply, req.query, facilities)
        if related:
            yield _sse({"related": related})
        yield _sse({"done": True})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
