"""Push alerts for real weather signals: fire on the change *into* high, once."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import live_data, signal_alerts

client = TestClient(app)


def _weather(level, state="Bihar", signal="flood"):
    return {
        "source": "test", "fetched_at": "t", "stale": False,
        "states": [{
            "state": state, "level": level,
            "signals": [{"id": signal, "label": "Heavy rain / flooding", "level": level,
                         "reason": "217 mm forecast over 7 days.", "suggested_crisis": "Monsoon Floods"}],
        }],
    }


@pytest.fixture
def feed(monkeypatch, temp_db):
    """A controllable weather feed: ``feed.level = "high"`` changes what the next check sees."""
    class Feed:
        level = "normal"

    f = Feed()
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather(f.level))
    return f


def test_becoming_high_creates_one_alert(feed, temp_db):
    feed.level = "high"
    made = signal_alerts.check_signals()
    assert len(made) == 1 and made[0]["state"] == "Bihar" and "now HIGH" in made[0]["title"]
    row = temp_db.notification_list()[0]
    assert row["kind"] == "live_signal_high" and "217 mm" in row["body"] and row["read"] is False
    assert any(e["kind"] == "live_signal_high" for e in temp_db.list_events())      # audit trail too


def test_a_signal_that_stays_high_alerts_once_not_every_poll(feed):
    feed.level = "high"
    assert len(signal_alerts.check_signals()) == 1
    assert signal_alerts.check_signals() == []
    assert signal_alerts.check_signals() == []


def test_elevated_does_not_alert(feed, temp_db):
    feed.level = "elevated"
    assert signal_alerts.check_signals() == []
    assert temp_db.notification_list() == []


def test_alert_rearms_after_the_signal_drops_out_of_high(feed):
    feed.level = "high"
    assert len(signal_alerts.check_signals()) == 1
    feed.level = "elevated"
    assert signal_alerts.check_signals() == []
    feed.level = "high"
    assert len(signal_alerts.check_signals()) == 1          # a genuinely new episode


def test_first_ever_check_alerts_if_already_high(feed):
    feed.level = "high"
    assert len(signal_alerts.check_signals()) == 1          # no previous level recorded


def test_feed_outage_creates_nothing_and_keeps_last_levels(feed, monkeypatch):
    feed.level = "high"
    signal_alerts.check_signals()

    def down():
        raise live_data.LiveDataError("down")

    monkeypatch.setattr(live_data, "state_weather", down)
    assert signal_alerts.check_signals() == []
    monkeypatch.setattr(live_data, "state_weather", lambda: _weather("high"))
    assert signal_alerts.check_signals() == []              # still the same episode, not a new alert


# ---------------------------------------------------------------- webhook

def test_webhook_receives_a_slack_compatible_payload(feed, monkeypatch):
    sent = []
    monkeypatch.setattr(signal_alerts.settings, "alert_webhook_url", "https://hooks.example/abc")
    monkeypatch.setattr(signal_alerts, "_post_webhook", lambda url, payload: sent.append((url, payload)))
    feed.level = "high"
    made = signal_alerts.check_signals()
    assert made[0]["delivery"] == "webhook delivered"
    url, payload = sent[0]
    assert url == "https://hooks.example/abc"
    assert payload["text"].startswith("Bihar: Heavy rain / flooding is now HIGH")
    assert payload["state"] == "Bihar" and payload["suggested_crisis"] == "Monsoon Floods"


def test_a_failing_webhook_never_loses_the_alert(feed, temp_db, monkeypatch):
    def boom(url, payload):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(signal_alerts.settings, "alert_webhook_url", "https://hooks.example/abc")
    monkeypatch.setattr(signal_alerts, "_post_webhook", boom)
    feed.level = "high"
    made = signal_alerts.check_signals()
    assert len(made) == 1 and made[0]["delivery"] == "webhook failed (RuntimeError)"
    assert temp_db.notification_list()[0]["delivery"] == "webhook failed (RuntimeError)"


def test_without_a_webhook_alerts_are_in_app_only(feed):
    feed.level = "high"
    assert signal_alerts.check_signals()[0]["delivery"] == "in-app only"


# ---------------------------------------------------------------- HTTP API

def test_notifications_api_lists_counts_and_marks_read(feed):
    feed.level = "high"
    signal_alerts.check_signals()
    listing = client.get("/api/notifications").json()
    assert listing["unread"] == 1 and listing["items"][0]["state"] == "Bihar"
    nid = listing["items"][0]["id"]
    assert client.get("/api/notifications", params={"unread_only": True}).json()["items"][0]["id"] == nid
    marked = client.post("/api/notifications/read", json={"ids": [nid]}).json()
    assert marked == {"marked": 1, "unread": 0}
    assert client.get("/api/notifications", params={"unread_only": True}).json()["items"] == []
    assert client.get("/api/notifications").json()["items"][0]["read"] is True


def test_mark_all_read(feed, temp_db):
    for st in ("A", "B", "C"):
        temp_db.notification_add("live_signal_high", f"{st} alert", "b", st, "flood", "high", "in-app only")
    assert client.post("/api/notifications/read", json={}).json()["marked"] == 3


def test_check_endpoint_runs_a_check_now(feed):
    feed.level = "high"
    out = client.post("/api/notifications/check").json()
    assert len(out["created"]) == 1 and out["unread"] == 1


def test_check_endpoint_is_rate_limited(feed):
    codes = [client.post("/api/notifications/check").status_code for _ in range(7)]
    assert codes[:6] == [200] * 6 and codes[6] == 429


def test_config_endpoint_never_exposes_the_webhook_url(monkeypatch):
    monkeypatch.setattr(signal_alerts.settings, "alert_webhook_url", "https://hooks.example/SECRET-TOKEN")
    body = client.get("/api/notifications/config").text
    assert "SECRET-TOKEN" not in body and '"webhook_configured":true' in body.replace(" ", "")


def test_a_simulation_reset_keeps_real_world_alerts(feed, temp_db, real_db_reset):
    feed.level = "high"
    signal_alerts.check_signals()
    real_db_reset()                                          # runs against the temp DB
    assert len(temp_db.notification_list()) == 1


# ---------------------------------------------------------------- background poller

def test_lifespan_starts_the_poller_only_when_enabled(monkeypatch):
    started = []

    async def fake_poll():
        started.append(1)

    monkeypatch.setattr(signal_alerts, "poll_forever", fake_poll)

    monkeypatch.setattr(signal_alerts.settings, "signal_polling_enabled", False)
    with TestClient(app):
        pass
    assert started == []

    monkeypatch.setattr(signal_alerts.settings, "signal_polling_enabled", True)
    monkeypatch.setattr(signal_alerts.settings, "live_data_enabled", True)
    with TestClient(app):
        pass
    assert started == [1]
