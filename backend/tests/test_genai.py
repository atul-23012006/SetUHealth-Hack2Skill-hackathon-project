"""Gemini layer: retry on transient errors, honest fallbacks, streaming, and the
SSE endpoint. A fake client replaces the SDK, so nothing here calls Google."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import genai

client = TestClient(app)


class FakeAPIError(Exception):
    def __init__(self, code):
        super().__init__(f"HTTP {code}")
        self.code = code


class Resp:
    def __init__(self, text):
        self.text = text


class FakeModels:
    """``script`` maps model name -> list of outcomes (a value, or an exception to raise)."""

    def __init__(self, script):
        self.script = {m: list(v) for m, v in script.items()}
        self.calls = []  # model names, in call order

    def _next(self, model):
        self.calls.append(model)
        item = self.script[model].pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def generate_content(self, model, **kw):
        return Resp(self._next(model))

    def generate_content_stream(self, model, **kw):
        return iter([Resp(t) for t in self._next(model)])


class FakeClient:
    def __init__(self, script):
        self.models = FakeModels(script)


PRIMARY, FALLBACK = "primary-model", "fallback-model"


@pytest.fixture
def live_client(monkeypatch):
    def install(script):
        fake = FakeClient(script)
        monkeypatch.setattr(genai, "_client_ready", True)
        monkeypatch.setattr(genai, "_client", fake)
        monkeypatch.setattr(genai, "_MODELS", [PRIMARY, FALLBACK])
        monkeypatch.setattr(genai.time, "sleep", lambda s: None)  # don't wait during retries
        return fake

    return install


def test_503_is_retried_once_on_the_same_model(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(503), "  hello  "], FALLBACK: []})
    assert genai._generate("hi") == "hello"
    assert fake.models.calls == [PRIMARY, PRIMARY]


def test_a_timeout_fails_over_immediately_without_retrying_the_stalled_model(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(504)], FALLBACK: ["from fallback"]})
    assert genai._generate("hi") == "from fallback"
    assert fake.models.calls == [PRIMARY, FALLBACK]


def test_persistent_503_fails_over_after_one_retry(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(503), FakeAPIError(503)], FALLBACK: ["ok"]})
    assert genai._generate("hi") == "ok"
    assert fake.models.calls == [PRIMARY, PRIMARY, FALLBACK]


def test_a_failed_model_is_skipped_during_its_cooldown_then_retried(live_client, monkeypatch):
    fake = live_client({PRIMARY: [FakeAPIError(504), "primary is back"], FALLBACK: ["fb 1", "fb 2"]})
    clock = [1000.0]
    monkeypatch.setattr(genai.time, "monotonic", lambda: clock[0])
    assert genai._generate("a") == "fb 1"              # primary times out, fallback answers
    assert genai._generate("b") == "fb 2"              # primary is skipped: straight to the fallback
    assert fake.models.calls == [PRIMARY, FALLBACK, FALLBACK]
    clock[0] += genai._COOLDOWN_S + 1                  # cooldown over: primary gets another chance
    assert genai._generate("c") == "primary is back"
    assert fake.models.calls[-1] == PRIMARY


def test_if_every_model_is_marked_down_they_are_all_still_tried(live_client):
    live_client({PRIMARY: [FakeAPIError(504), "recovered"], FALLBACK: [FakeAPIError(504)]})
    assert genai._generate("a") is None                # both fail and both enter cooldown
    assert genai._generate("b") == "recovered"         # nothing healthy: try everything rather than give up


def test_client_errors_do_not_retry_but_still_try_the_fallback(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(404)], FALLBACK: ["ok"]})
    assert genai._generate("hi") == "ok"
    assert fake.models.calls == [PRIMARY, FALLBACK]


def test_every_model_failing_returns_none_and_is_bounded(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(504)], FALLBACK: [FakeAPIError(504)]})
    assert genai._generate("hi") is None
    assert fake.models.calls == [PRIMARY, FALLBACK]


def test_fallback_says_gemini_is_unavailable_when_a_key_is_configured(live_client):
    live_client({PRIMARY: [FakeAPIError(504)], FALLBACK: [FakeAPIError(504)]})
    reply = genai.chat_reply("q", "the context", "en")
    assert "temporarily unavailable" in reply and "connect a Gemini API key" not in reply


def test_fallback_asks_for_a_key_only_when_none_is_configured():
    reply = genai.chat_reply("q", "the context", "en")  # conftest: no live client
    assert "connect a Gemini API key" in reply and "the context" in reply


def test_stream_yields_chunks_in_order(live_client):
    live_client({PRIMARY: [["Hel", "lo ", "world"]], FALLBACK: []})
    assert "".join(genai.chat_reply_stream("q", "ctx")) == "Hello world"


def test_stream_fails_over_to_the_fallback_model(live_client):
    fake = live_client({PRIMARY: [FakeAPIError(504)], FALLBACK: [["from ", "fallback"]]})
    assert "".join(genai.chat_reply_stream("q", "ctx")) == "from fallback"
    assert fake.models.calls == [PRIMARY, FALLBACK]


def test_stream_uses_the_summary_when_every_model_fails(live_client):
    live_client({PRIMARY: [FakeAPIError(504)], FALLBACK: [FakeAPIError(504)]})
    out = "".join(genai.chat_reply_stream("q", "the context"))
    assert "temporarily unavailable" in out and "the context" in out


def test_offline_stream_is_word_by_word_and_reassembles_exactly():
    chunks = list(genai.chat_reply_stream("q", "alpha beta"))
    assert len(chunks) > 3
    assert "".join(chunks) == genai._offline_reply("alpha beta", "en")


def test_offline_reply_truncates_on_line_boundaries_not_mid_word():
    # A long multi-line context (like _build_context's alert/rec list) must
    # never get cut mid-word — every kept line must appear in full.
    lines = [f"- Facility {i} (District {i}, State {i}): Some Medicine ~{i} days left [critical]" for i in range(30)]
    context = "\n".join(lines)
    reply = genai._offline_reply(context, "en")
    body = reply.split("\n", 1)[1]  # drop the "(Offline demo mode...)" intro line
    kept_lines = [ln for ln in body.split("\n") if ln.startswith("- Facility")]
    assert kept_lines  # something survived
    for ln in kept_lines:
        assert ln in lines  # each kept line is a whole, unmodified line — never a fragment


def test_offline_reply_says_how_many_lines_were_omitted():
    lines = [f"- entry {i}" for i in range(50)]
    context = "\n".join(lines)
    reply = genai._offline_reply(context, "en")
    assert "more lines omitted" in reply


def test_offline_reply_short_context_is_not_marked_as_truncated():
    reply = genai._offline_reply("- only one line", "en")
    assert "omitted" not in reply


def _events(text):
    return [json.loads(line[6:]) for line in text.split("\n\n") if line.startswith("data: ")]


def test_sse_endpoint_streams_deltas_then_done():
    r = client.post("/api/assistant/chat/stream", json={"query": "how many alerts?", "lang": "en"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = _events(r.text)
    assert events[-1] == {"done": True}
    assert "".join(e["delta"] for e in events if "delta" in e).startswith("(Offline demo mode")


def test_sse_endpoint_sends_action_feedback_first(monkeypatch):
    # The real "reset" action wipes the store and ledger, so it is stubbed out here.
    from app.routers import assistant

    monkeypatch.setattr(assistant, "execute_action", lambda action, user=None: "[SYSTEM ACTION] stubbed reset done")
    r = client.post("/api/assistant/chat/stream", json={"query": "reset the simulation data", "lang": "en"})
    assert _events(r.text)[0]["delta"].startswith("[SYSTEM ACTION] stubbed reset done")


def test_related_facilities_matches_only_names_present_in_the_text():
    from app.routers.assistant import _related_facilities

    facilities = [
        {"phc_id": "A", "phc_name": "Pune PHC 1"},
        {"phc_id": "B", "phc_name": "Nashik PHC 2"},
        {"phc_id": "A", "phc_name": "Pune PHC 1"},  # duplicate: still one link
        {"phc_id": "C", "phc_name": "Gaya PHC 3"},
    ]
    related = _related_facilities("Pune PHC 1 is low on stock.", "and what about Gaya PHC 3?", facilities)
    assert [f["phc_id"] for f in related] == ["A", "C"]  # B never named; A de-duplicated
    assert _related_facilities("nothing relevant", "hello", facilities) == []


def test_related_facilities_is_capped():
    from app.routers.assistant import _related_facilities

    facilities = [{"phc_id": str(i), "phc_name": f"Facility {i:02d}"} for i in range(20)]
    text = " ".join(f["phc_name"] for f in facilities)
    assert len(_related_facilities(text, "", facilities, limit=5)) == 5


def test_sse_related_event_names_only_real_facilities_the_reply_mentioned():
    from app.services import store

    r = client.post("/api/assistant/chat/stream", json={"query": "how many alerts?", "lang": "en"})
    events = _events(r.text)
    reply = "".join(e["delta"] for e in events if "delta" in e)
    related = [e["related"] for e in events if "related" in e]
    assert events[-1] == {"done": True}
    assert related, "the offline reply echoes alert lines, so it should name facilities"
    for f in related[0]:
        assert f["phc_id"] in store.PHC_BY_ID
        assert f["phc_name"] in reply  # a link is only offered for a name the reply actually contains


def test_non_streaming_chat_returns_related_facilities():
    r = client.post("/api/assistant/chat", json={"query": "hello", "lang": "en"})
    body = r.json()
    assert isinstance(body["related"], list)
    for f in body["related"]:
        assert f["phc_name"] in body["reply"]


def test_the_guard_refuses_a_real_reset():
    from app.services import store

    with pytest.raises(AssertionError, match="stub it instead"):
        store.reset_store_data()


def test_non_streaming_chat_still_works():
    r = client.post("/api/assistant/chat", json={"query": "hello", "lang": "en"})
    assert r.status_code == 200 and "reply" in r.json()
