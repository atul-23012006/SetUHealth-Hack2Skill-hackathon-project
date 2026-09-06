"""Google Gemini integration for natural-language alert explanations and the
multilingual assistant chat. Degrades gracefully to a deterministic templated
mock when no GEMINI_API_KEY is configured, so the whole app is demoable
before a key is issued - swapping in a real key requires no code changes.
"""
import logging

from app.config import settings

logger = logging.getLogger(__name__)

_MODEL_NAME = "gemini-3.6-flash"
_client_ready = False

if settings.gemini_api_key:
    try:
        import google.generativeai as genai

        genai.configure(api_key=settings.gemini_api_key)
        _model = genai.GenerativeModel(_MODEL_NAME)
        _client_ready = True
    except Exception:
        _client_ready = False


LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "ta": "Tamil"}


def _generate(prompt: str) -> str | None:
    if _client_ready:
        try:
            response = _model.generate_content(prompt)
            return response.text.strip()
        except Exception:
            # Network/quota/model errors: log the real cause server-side, but
            # never surface raw API error text as if it were a generated
            # answer - fall through to the deterministic mock templates below,
            # same as the no-API-key path, so the UI degrades cleanly instead
            # of showing a stack-trace-looking string to a health worker.
            logger.warning("Gemini generation failed, falling back to mock", exc_info=True)
            return None
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


def chat_reply(query: str, context_summary: str, lang: str = "en") -> str:
    lang_name = LANG_NAMES.get(lang, "English")
    prompt = (
        f"You are 'Setu Assistant', a helpful assistant for health workers using a national "
        f"PHC (Primary Health Centre) resource management platform. Answer in {lang_name}, "
        f"briefly and concretely, using only the data context given. If the answer isn't in "
        f"the context, say what data would be needed.\n\n"
        f"Data context:\n{context_summary}\n\n"
        f"Question: {query}"
    )
    generated = _generate(prompt)
    if generated:
        return generated

    offline_msgs = {
        "en": "(Offline demo mode - connect a Gemini API key for live answers.) Based on current data:\n",
        "hi": "(ऑफलाइन डेमो मोड - लाइव उत्तरों के लिए जेमिनी एपीआई की कनेक्ट करें।) वर्तमान डेटा के आधार पर:\n",
        "mr": "(ऑफलाइन डेमो मोड - थेट उत्तरांसाठी जेमिनी एपीआई की कनेक्ट करा.) सध्याच्या माहितीच्या आधारे:\n",
        "ta": "(ஆஃப்லைன் டெமோ பயன்முறை - நேரடி பதில்களுக்கு ஜெமினி ஏபிஐ விசையை இணைக்கவும்.) தற்போதைய தரவுகளின் அடிப்படையில்:\n",
    }
    intro = offline_msgs.get(lang, offline_msgs["en"])
    return f"{intro}{context_summary[:400]}"


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
            response = _model.generate_content(prompt)
            text = response.text.strip()
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

