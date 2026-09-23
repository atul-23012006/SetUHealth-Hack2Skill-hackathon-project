"""Google Gemini integration for natural-language alert explanations and the
multilingual assistant chat. Degrades gracefully to a deterministic templated
mock when no GEMINI_API_KEY is configured, so the whole app is demoable
before a key is issued - swapping in a real key requires no code changes.
"""
import logging
import time

from app.config import settings

logger = logging.getLogger(__name__)

_MODELS = [m for m in (settings.gemini_model, settings.gemini_fallback_model) if m]
_client_ready = False
_client = None
_GEN_CONFIG = None

if settings.gemini_api_key:
    try:
        # `google-genai` (the maintained SDK; the old `google-generativeai` is deprecated).
        from google import genai
        from google.genai import types

        _client = genai.Client(
            api_key=settings.gemini_api_key,
            # One attempt per call and a hard timeout: the SDK's own retry loop
            # otherwise stalls a request for a minute or more during an outage.
            # Retrying and failing over is handled below, where it can be quick.
            http_options=types.HttpOptions(timeout=10_000, retry_options=types.HttpRetryOptions(attempts=1)),
        )
        # Plain text generation only: no tool calling, so no "automatic function
        # calling" notice on every request.
        _GEN_CONFIG = types.GenerateContentConfig(
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )
        _client_ready = True
    except Exception:
        _client_ready = False


LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "ta": "Tamil"}


# Google sheds load per model with 429/5xx (and 504 when a model stalls). A 503
# or 429 often clears within a second, so it gets one short retry; a timeout
# does not (waiting again would only double the delay). Either way we then fail
# over to the next configured model before giving up on the live API.
_TRANSIENT_CODES = {429, 500, 502, 503, 504}
_RETRY_ONCE_CODES = {429, 503}


def _code(exc: Exception):
    return getattr(exc, "code", None) or getattr(exc, "status_code", None)


def _is_transient(exc: Exception) -> bool:
    return _code(exc) in _TRANSIENT_CODES


# Circuit breaker: a model that just failed is skipped for a while, so only the
# first request after an outage pays the timeout instead of every request.
_COOLDOWN_S = 90.0
_down_until: dict[str, float] = {}


def _candidate_models() -> list[str]:
    now = time.monotonic()
    healthy = [m for m in _MODELS if _down_until.get(m, 0.0) <= now]
    return healthy or list(_MODELS)  # if everything is marked down, still try them all


def _call_models(call):
    """Run ``call(model)`` down the healthy models; returns the first result, or
    raises the last exception when every model failed."""
    last: Exception | None = None
    candidates = _candidate_models()
    for model in candidates:
        for attempt in range(2):
            try:
                result = call(model)
                _down_until.pop(model, None)
                return result
            except Exception as exc:
                last = exc
                if _code(exc) in _RETRY_ONCE_CODES and attempt == 0:
                    time.sleep(0.8)
                    continue
                break  # next model
        _down_until[model] = time.monotonic() + _COOLDOWN_S
        logger.warning("Gemini model %s failed (%s)%s", model, type(last).__name__, ", trying the next model" if model != candidates[-1] else "")
    raise last if last else RuntimeError("no Gemini model configured")


def _generate_stream(prompt: str):
    """Yield text chunks from Gemini as they arrive; None when there is no live
    client or every model failed to start (callers then use the fallback text).
    A failure mid-stream just ends the stream, since the reader already has the
    earlier chunks."""
    if not _client_ready:
        return None

    def open_stream(model):
        stream = _client.models.generate_content_stream(model=model, contents=prompt, config=_GEN_CONFIG)
        first = next((c.text for c in stream if c.text), None)
        if first is None:
            raise ValueError("empty stream")
        return stream, first

    try:
        stream, first = _call_models(open_stream)
    except Exception:
        return None

    def chunks():
        yield first
        try:
            for c in stream:
                if c.text:
                    yield c.text
        except Exception:
            logger.warning("Gemini stream ended early", exc_info=True)

    return chunks()


def _generate(prompt: str) -> str | None:
    if not _client_ready:
        return None

    def once(model):
        response = _client.models.generate_content(model=model, contents=prompt, config=_GEN_CONFIG)
        text = (response.text or "").strip()
        if not text:
            raise ValueError("empty response")
        return text

    try:
        return _call_models(once)
    except Exception:
        # Network/quota/model errors are logged server-side, but raw API error
        # text is never surfaced as if it were a generated answer: callers fall
        # through to deterministic templates, same as the no-API-key path, so a
        # health worker never sees a stack-trace-looking string.
        return None


def explain_alert(alert: dict, lang: str = "en") -> str:
    lang_name = LANG_NAMES.get(lang, "English")
    prompt = (
        f"You are a supply-chain assistant for India's public health network. "
        f"In {lang_name}, in 2-3 short sentences, explain this stockout risk to a "
        f"district health officer and suggest the single most useful next action. "
        f"Be concrete, not generic.\n\n"
        f"Facility: {alert['phc_name']}, {alert['district']}, {alert['state']}\n"
        f"Medicine: {alert['medicine']}\n"
        f"Current stock: {alert['current_level']} {alert['unit']}\n"
        f"Estimated daily use: {alert['daily_depletion_rate']} {alert['unit']}/day\n"
        f"Days to stockout: {alert['days_to_stockout']}\n"
        f"Risk level: {alert['risk']}"
    )
    generated = _generate(prompt)
    if generated:
        return generated

    # deterministic mock fallback
    templates = {
        "en": (
            f"{alert['phc_name']} ({alert['district']}, {alert['state']}) has about "
            f"{alert['days_to_stockout']} days of {alert['medicine']} left at current usage. "
            f"Recommend an urgent resupply or a redistribution transfer from a nearby surplus facility."
        ),
        "hi": (
            f"{alert['phc_name']} ({alert['district']}, {alert['state']}) mein {alert['medicine']} "
            f"lagbhag {alert['days_to_stockout']} dinon mein khatam ho sakti hai. "
            f"Turant punah-poorti ya nikatvarti PHC se stock transfer ki sifarish ki jaati hai."
        ),
        "mr": (
            f"{alert['phc_name']} ({alert['district']}, {alert['state']}) मध्ये चालू वापरानुसार "
            f"{alert['medicine']} चा साठा सुमारे {alert['days_to_stockout']} दिवस शिल्लक आहे. "
            f"त्वरित पुनर्रचना किंवा जवळच्या अतिरिक्त सुविधा केंद्रातून स्टॉक ट्रान्सफर करण्याची शिफारस केली जाते."
        ),
        "ta": (
            f"{alert['phc_name']} ({alert['district']}, {alert['state']}) இல் தற்போதைய பயன்பாட்டின் படி "
            f"{alert['medicine']} மருந்து இன்னும் சுமார் {alert['days_to_stockout']} நாட்களுக்கு மட்டுமே இருக்கும். "
            f"உடனடியாக புதிய விநியோகம் அல்லது அருகிலுள்ள உபரி சுகாதார மையத்திலிருந்து மருந்து மாற்ற பரிந்துரைக்கப்படுகிறது."
        ),
    }
    return templates.get(lang, templates["en"])


_OFFLINE_INTRO = {
    "en": "(Offline demo mode - connect a Gemini API key for live answers.) Based on current data:\n",
    "hi": "(ऑफलाइन डेमो मोड - लाइव उत्तरों के लिए जेमिनी एपीआई की कनेक्ट करें।) वर्तमान डेटा के आधार पर:\n",
    "mr": "(ऑफलाइन डेमो मोड - थेट उत्तरांसाठी जेमिनी एपीआई की कनेक्ट करा.) सध्याच्या माहितीच्या आधारे:\n",
    "ta": "(ஆஃப்லைன் டெமோ பயன்முறை - நேரடி பதில்களுக்கு ஜெமினி ஏபிஐ விசையை இணைக்கவும்.) தற்போதைய தரவுகளின் அடிப்படையில்:\n",
}


def _chat_prompt(query: str, context_summary: str, lang: str) -> str:
    lang_name = LANG_NAMES.get(lang, "English")
    return (
        f"You are 'Setu Assistant', a helpful assistant for health workers using a national "
        f"PHC (Primary Health Centre) resource management platform. Answer in {lang_name}, "
        f"briefly and concretely, using only the data context given. If the answer isn't in "
        f"the context, say what data would be needed.\n\n"
        f"Data context:\n{context_summary}\n\n"
        f"Question: {query}"
    )


# Shown instead when a key IS configured but Gemini could not answer just now.
_UNAVAILABLE_INTRO = {
    "en": "(Gemini is temporarily unavailable, so here is a data summary instead.) Based on current data:\n",
    "hi": "(जेमिनी अभी अस्थायी रूप से उपलब्ध नहीं है, इसलिए यहाँ डेटा सारांश है।) वर्तमान डेटा के आधार पर:\n",
    "mr": "(जेमिनी सध्या तात्पुरते उपलब्ध नाही, म्हणून येथे माहितीचा सारांश आहे.) सध्याच्या माहितीच्या आधारे:\n",
    "ta": "(ஜெமினி தற்காலிகமாக கிடைக்கவில்லை, எனவே தரவு சுருக்கம் இங்கே.) தற்போதைய தரவுகளின் அடிப்படையில்:\n",
}


def _offline_reply(context_summary: str, lang: str) -> str:
    intros = _UNAVAILABLE_INTRO if _client_ready else _OFFLINE_INTRO
    return f"{intros.get(lang, intros['en'])}{context_summary[:400]}"


def chat_reply(query: str, context_summary: str, lang: str = "en") -> str:
    generated = _generate(_chat_prompt(query, context_summary, lang))
    if generated:
        return generated
    return _offline_reply(context_summary, lang)


def chat_reply_stream(query: str, context_summary: str, lang: str = "en"):
    """Yield the reply in chunks. Live Gemini streams token batches as they
    arrive; the offline mock is streamed word by word so the UI behaves the same
    either way."""
    live = _generate_stream(_chat_prompt(query, context_summary, lang))
    if live is not None:
        yield from live
        return
    words = _offline_reply(context_summary, lang).split(" ")
    for i, w in enumerate(words):
        yield w if i == len(words) - 1 else w + " "


def parse_chat_action(query: str) -> dict | None:
    import json
    import re
    from app.services import store
    
    q = query.lower().strip()
    
    if _client_ready:
        try:
            prompt = (
                "Analyze this user query for supply chain actions. "
                "Supported actions:\n"
                "1. RESET: Reset the simulation database. parameters: {}\n"
                "2. TRANSFER: Move medicine between PHCs. parameters: {from_phc_id, to_phc_id, medicine, quantity}\n"
                "3. CRISIS: Trigger a crisis simulation. parameters: {target_type (state/district/phc), target_name (e.g. Pune/Maharashtra/PHC-0001), crisis_type (Dengue Outbreak/Malaria Outbreak/Monsoon Floods/Cold Chain Failure)}\n\n"
                "Return a raw JSON object ONLY, like:\n"
                "{\"action\": \"transfer\", \"from_phc_id\": \"PHC-0001\", \"to_phc_id\": \"PHC-0002\", \"medicine\": \"Paracetamol 500mg\", \"quantity\": 15.0}\n"
                "If no action is requested, return {\"action\": \"none\"}.\n\n"
                f"Query: {query}"
            )
            text = (_generate(prompt) or "").strip()
            if not text:
                raise ValueError("empty model response")
            # Clean JSON markdown blocks if any
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0].strip()
            elif "```" in text:
                text = text.split("```")[1].split("```")[0].strip()
            data = json.loads(text)
            if data.get("action") and data["action"] != "none":
                return data
        except Exception:
            logger.warning("Gemini action parsing failed, using regex fallback")

    # Fallback regex parser for offline demo mode
    # 1. Reset Action
    if "reset" in q and ("simulation" in q or "database" in q or "data" in q or "store" in q):
        return {"action": "reset"}
        
    # 2. Transfer Action
    transfer_match = re.search(
        r'(?:transfer|move)\s+(\d+(?:\.\d+)?)\s+(?:units\s+of\s+)?(.*?)\s+from\s+(phc-\d+)\s+to\s+(phc-\d+)',
        q
    )
    if transfer_match:
        qty = float(transfer_match.group(1))
        med = transfer_match.group(2).strip().title()
        
        # Spelling normalization
        for m in store.MEDICINES:
            if med.lower() in m["name"].lower() or m["name"].lower() in med.lower():
                med = m["name"]
                break
        from_id = transfer_match.group(3).upper()
        to_id = transfer_match.group(4).upper()
        return {
            "action": "transfer",
            "from_phc_id": from_id,
            "to_phc_id": to_id,
            "medicine": med,
            "quantity": qty
        }
        
    # 3. Crisis Simulation Action
    crisis_match = re.search(
        r'(?:trigger|simulate|fail)\s+(dengue|malaria|floods|cold\s+chain|monsoon\s+floods|dengue\s+outbreak|malaria\s+outbreak|cold\s+chain\s+failure)\s+(?:in|for)?\s*(?:state|district|phc)?\s*([a-zA-Z0-9\s\-]+)',
        q
    )
    if crisis_match:
        c_type_raw = crisis_match.group(1).strip()
        target = crisis_match.group(2).strip().title()
        
        c_type = "Dengue Outbreak"
        if "malaria" in c_type_raw:
            c_type = "Malaria Outbreak"
        elif "flood" in c_type_raw:
            c_type = "Monsoon Floods"
        elif "cold" in c_type_raw or "failure" in c_type_raw:
            c_type = "Cold Chain Failure"
            
        target_type = "district"
        import app.data.reference as ref
        if target in ref.STATES:
            target_type = "state"
        elif target.upper() in store.PHC_BY_ID:
            target_type = "phc"
            target = target.upper()
            
        return {
            "action": "crisis",
            "target_type": target_type,
            "target_name": target,
            "crisis_type": c_type
        }
        
    return None


def explain_anomaly(anomaly: dict, lang: str = "en") -> str:
    """Write a short investigator-facing note on a consumption-vs-footfall anomaly."""
    lang_name = LANG_NAMES.get(lang, "English")
    meds = ", ".join(anomaly.get("flagged_medicines", [])) or "multiple medicines"
    direction_text = (
        "medicine stock is being consumed far faster than patient footfall justifies "
        "(possible pilferage, leakage, or write-offs booked as dispensing)"
        if anomaly.get("direction") == "over_consumption"
        else "patient footfall is steady or rising but the stock ledger is barely moving "
        "(likely a data-entry breakdown, possibly diversion hidden by bad bookkeeping)"
    )
    prompt = (
        f"You are a supply-chain integrity analyst for India's public health network. "
        f"In {lang_name}, in 2-3 short sentences, explain this flagged facility to a "
        f"district health officer and give the single most useful next verification step. "
        f"Be concrete, not generic.\n\n"
        f"Facility: {anomaly.get('phc_name')}, {anomaly.get('district')}, {anomaly.get('state')}\n"
        f"Finding: over the last {anomaly.get('window_days')} days, {direction_text}.\n"
        f"Recorded dispensing change vs baseline: {anomaly.get('consumption_change_pct')}%\n"
        f"Patient footfall change vs baseline: {anomaly.get('footfall_change_pct')}%\n"
        f"Average patient visits/day now: {anomaly.get('avg_daily_visits')} "
        f"(baseline {anomaly.get('baseline_daily_visits')})\n"
        f"Most affected medicines: {meds}\n"
        f"Anomaly score (robust z): {anomaly.get('z_score')}"
    )
    generated = _generate(prompt)
    if generated:
        return generated

    # Deterministic offline fallback
    if anomaly.get("direction") == "over_consumption":
        return (
            f"{anomaly.get('phc_name')} recorded a {anomaly.get('consumption_change_pct')}% change in "
            f"dispensing of {meds} while patient footfall moved only "
            f"{anomaly.get('footfall_change_pct')}% — the stock is leaving the shelf faster than "
            f"patients can account for. Cross-check the last {anomaly.get('window_days')} days of "
            f"issue registers against OPD tickets and physically count remaining stock of {meds}."
        )
    return (
        f"{anomaly.get('phc_name')} saw patient footfall move {anomaly.get('footfall_change_pct')}% "
        f"but its {meds} ledger changed only {anomaly.get('consumption_change_pct')}% — dispensing is "
        f"almost certainly not being recorded. Confirm whether the pharmacy register is being "
        f"maintained and reconcile the last {anomaly.get('window_days')} days before trusting this "
        f"facility's stock figures in forecasting."
    )


def explain_transfer(rec: dict, from_forecast: dict, to_forecast: dict, lang: str = "en") -> str:
    """Generate a plain-English explanation of why a redistribution transfer is recommended."""
    lang_name = LANG_NAMES.get(lang, "English")
    spare = round(from_forecast.get("current_level", 0) - from_forecast.get("reorder_level", 0), 1)
    days = to_forecast.get("days_to_stockout")

    prompt = (
        f"You are a supply-chain assistant for India's public health network. "
        f"In {lang_name}, in 2-3 short sentences, explain why this medicine transfer is recommended. "
        f"Be concrete about days to stockout, spare units, and urgency. Don't be generic.\n\n"
        f"Transfer: {rec.get('quantity', '?')} {rec.get('unit', 'units')} of {rec.get('medicine', '?')}\n"
        f"Donor: {rec.get('from_phc_name', '')} ({rec.get('from_district', '')}, {rec.get('from_state', '')}) "
        f"— stock: {from_forecast.get('current_level', '?')} {rec.get('unit', '')}, "
        f"{spare} {rec.get('unit', '')} above reorder level\n"
        f"Recipient: {rec.get('to_phc_name', '')} ({rec.get('to_district', '')}, {rec.get('to_state', '')}) "
        f"— stock: {to_forecast.get('current_level', '?')} {rec.get('unit', '')}, "
        f"days to stockout: {days}, risk: {to_forecast.get('risk', '?')}"
    )
    generated = _generate(prompt)
    if generated:
        return generated

    # Deterministic offline fallback
    return (
        f"{rec.get('to_phc_name', 'The recipient facility')} has only {days} days of "
        f"{rec.get('medicine', 'this medicine')} remaining and is classified as "
        f"{to_forecast.get('risk', 'high')} risk. "
        f"{rec.get('from_phc_name', 'The donor facility')} holds {spare} {rec.get('unit', 'units')} "
        f"above its safe reorder level, making it the optimal donor. "
        f"This transfer of {rec.get('quantity', '?')} {rec.get('unit', 'units')} will extend supply "
        f"at {rec.get('to_phc_name', 'the recipient')} beyond the 14-day safety threshold."
    )

