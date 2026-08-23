"""Google Gemini integration for natural-language alert explanations and the
multilingual assistant chat. Degrades gracefully to a deterministic templated
mock when no GEMINI_API_KEY is configured, so the whole app is demoable
before a key is issued - swapping in a real key requires no code changes.
"""
from app.config import settings

_MODEL_NAME = "gemini-2.0-flash"
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


def _generate(prompt: str) -> str:
    if _client_ready:
        try:
            response = _model.generate_content(prompt)
            return response.text.strip()
        except Exception as exc:  # network/quota errors -> fall back rather than 500
            return f"[AI temporarily unavailable, showing summary instead] {exc}"
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
