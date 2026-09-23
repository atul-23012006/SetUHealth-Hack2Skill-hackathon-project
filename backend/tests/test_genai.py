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


def test_the_guard_refuses_a_real_reset():
    from app.services import store

    with pytest.raises(AssertionError, match="stub it instead"):
        store.reset_store_data()


def test_non_streaming_chat_still_works():
    r = client.post("/api/assistant/chat", json={"query": "hello", "lang": "en"})
    assert r.status_code == 200 and "reply" in r.json()
