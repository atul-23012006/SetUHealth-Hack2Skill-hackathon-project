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

    return (
        f"(Offline demo mode - connect a Gemini API key for live answers.) "
        f"Based on current data: {context_summary[:400]}"
    )
