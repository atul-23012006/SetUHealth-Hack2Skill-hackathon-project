"""Live real-world data layer. The network seam (``live_data._request``) is
faked throughout, so these tests prove parsing, derivation, caching and
failure behaviour without touching a real API."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import assistant
from app.services import live_data, store

client = TestClient(app)


def _raw_weather(lat, lon, rain, tmax=32.0, tmin=24.0, humidity=80, temp=29.0):
    return {
        "latitude": lat, "longitude": lon,
        "current": {
            "time": "2026-09-21T10:00", "temperature_2m": temp, "apparent_temperature": temp + 3,
            "relative_humidity_2m": humidity, "precipitation": 0.0, "wind_speed_10m": 9.0,
        },
        "daily": {
            "time": [f"2026-09-{21 + i}" for i in range(len(rain))],
            "precipitation_sum": rain,
            "temperature_2m_max": [tmax] * len(rain),
            "temperature_2m_min": [tmin] * len(rain),
        },
    }


def _signal(signals, sid):
    return next(s for s in signals if s["id"] == sid)


# ---------------------------------------------------------------- signals

def test_heavy_rain_day_raises_flood_signal_with_suggested_crisis():
    raw = _raw_weather(25, 85, [0, 0, 130, 0, 0, 0, 0])  # one very heavy day (IMD >= 115.6 mm)
    signals = live_data.derive_signals(raw["current"], raw["daily"])
    flood = _signal(signals, "flood")
    assert flood["level"] == "high"
    assert flood["suggested_crisis"] == "Monsoon Floods"
    assert "130" in flood["reason"]  # the triggering number is shown


def test_weekly_total_alone_can_raise_flood_signal_and_reason_states_that_rule():
    raw = _raw_weather(25, 85, [40, 40, 40, 40, 40, 5, 5])  # no single heavy day, but 210 mm in the week
    flood = _signal(live_data.derive_signals(raw["current"], raw["daily"]), "flood")
    assert flood["level"] == "high"
    assert ">= 200 mm in the week" in flood["reason"]  # the rule that fired is visible to the reader


def test_dry_mild_week_is_all_normal():
    raw = _raw_weather(25, 85, [0] * 7, tmax=30, tmin=20, humidity=40)
    signals = live_data.derive_signals(raw["current"], raw["daily"])
    assert all(s["level"] == "normal" for s in signals)
    assert all(s["suggested_crisis"] is None for s in signals)


def test_extreme_heat_flags_cold_chain():
    raw = _raw_weather(26, 75, [0] * 7, tmax=42, tmin=30, humidity=30)
    assert _signal(live_data.derive_signals(raw["current"], raw["daily"]), "heat")["level"] == "high"


def test_warm_wet_humid_conditions_flag_mosquito_borne_risk():
    raw = _raw_weather(10, 76, [15, 15, 15, 15, 15, 15, 15], tmax=31, tmin=24, humidity=82)  # 105 mm, warm, humid
    vector = _signal(live_data.derive_signals(raw["current"], raw["daily"]), "vector")
    assert vector["level"] == "high"
    assert vector["suggested_crisis"] == "Dengue Outbreak"


# ---------------------------------------------------------------- weather feeds

def test_state_weather_returns_one_entry_per_state_and_is_cached(monkeypatch):
    calls = []

    def fake(method, url, **kw):
        calls.append(url)
        lats = kw["params"]["latitude"].split(",")
        lons = kw["params"]["longitude"].split(",")
        return [_raw_weather(float(a), float(b), [2] * 7) for a, b in zip(lats, lons)]

    monkeypatch.setattr(live_data, "_request", fake)
    first = live_data.state_weather()
    assert {s["state"] for s in first["states"]} == set(live_data.state_centroids())
    assert first["stale"] is False and "Open-Meteo" in first["source"]
    live_data.state_weather()
    assert len(calls) == 1  # second call served from cache


def test_stale_data_is_served_and_marked_when_upstream_fails_after_expiry(monkeypatch):
    def ok(method, url, **kw):
        n = len(kw["params"]["latitude"].split(","))
        return [_raw_weather(20, 75, [1] * 7) for _ in range(n)]

    monkeypatch.setattr(live_data, "_request", ok)
    live_data.state_weather()

    def down(*a, **k):
        raise live_data.LiveDataError("down")

    monkeypatch.setattr(live_data, "_request", down)
    real_time = live_data.time.time
    monkeypatch.setattr(live_data.time, "time", lambda: real_time() + 10_000)  # past the 15-minute TTL
    result = live_data.state_weather()
    assert result["stale"] is True and result["states"]


def test_place_snapshot_survives_air_quality_outage(monkeypatch):
    def fake(method, url, **kw):
        if "air-quality" in url:
            raise live_data.LiveDataError("air down")
        return _raw_weather(18.5, 73.8, [5] * 7)

    monkeypatch.setattr(live_data, "_request", fake)
    snap = live_data.place_snapshot(18.5, 73.8)
    assert snap["air"] is None and snap["weather"]["rain_7d_mm"] == 35


def test_place_snapshot_reports_aqi_category(monkeypatch):
    def fake(method, url, **kw):
        if "air-quality" in url:
            return {"current": {"us_aqi": 132, "pm2_5": 48.0, "pm10": 90.0, "time": "t"}}
        return _raw_weather(28.6, 77.2, [0] * 7)

    monkeypatch.setattr(live_data, "_request", fake)
    assert live_data.place_snapshot(28.6, 77.2)["air"]["category"] == "Unhealthy for sensitive groups"


# ---------------------------------------------------------------- geocode / benchmarks

def test_geocode_maps_results_and_ignores_short_queries(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: {"results": [
        {"name": "Pune", "admin1": "Maharashtra", "admin2": "Pune", "country": "India",
         "latitude": 18.52, "longitude": 73.86, "population": 3124458}]})
    hit = live_data.geocode("Pune")["results"][0]
    assert (hit["name"], hit["admin1"], hit["lat"], hit["lon"]) == ("Pune", "Maharashtra", 18.52, 73.86)
    assert live_data.geocode("a")["results"] == []


def test_benchmarks_pick_latest_non_null_value_per_country(monkeypatch):
    rows = [
        {"countryiso3code": "IND", "date": "2021", "value": 0.5},
        {"countryiso3code": "IND", "date": "2023", "value": 0.7},
        {"countryiso3code": "IND", "date": "2024", "value": None},
        {"countryiso3code": "BRA", "date": "2022", "value": 2.5},
    ]
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: [{"page": 1}, rows])
    out = live_data.benchmarks("SH.MED.PHYS.ZS", ["IND", "BRA", "XXX"])
    by = {c["iso3"]: c for c in out["countries"]}
    assert set(by) == {"IND", "BRA"}  # unknown code dropped
    assert by["IND"]["latest"] == {"year": 2023, "value": 0.7}
    assert [p["year"] for p in by["IND"]["series"]] == [2021, 2023]
    assert out["indicator"]["unit"] == "per 1,000 people"


def test_benchmarks_reject_unknown_indicator():
    with pytest.raises(ValueError):
        live_data.benchmarks("NOT.AN.INDICATOR")


# ---------------------------------------------------------------- OpenStreetMap

def test_osm_facilities_parse_sort_and_skip_unlocatable_elements(monkeypatch):
    elements = [
        {"type": "way", "id": 2, "center": {"lat": 18.60, "lon": 73.90}, "tags": {"amenity": "clinic", "name": "Far Clinic"}},
        {"type": "node", "id": 1, "lat": 18.521, "lon": 73.856, "tags": {"amenity": "hospital", "name": "Near Hospital"}},
        {"type": "node", "id": 3, "tags": {"amenity": "doctors"}},  # no coordinates
    ]
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: {"elements": elements})
    out = live_data.osm_facilities(18.5196, 73.8554, 10)
    assert [f["name"] for f in out["facilities"]] == ["Near Hospital", "Far Clinic"]
    assert out["facilities"][0]["osm_url"].endswith("node/1")
    assert "OpenStreetMap" in out["source"]


def test_osm_falls_back_to_second_mirror(monkeypatch):
    seen = []

    def fake(method, url, **kw):
        seen.append(url)
        if url == live_data.OVERPASS_MIRRORS[0]:
            raise live_data.LiveDataError("busy")
        return {"elements": []}

    monkeypatch.setattr(live_data, "_request", fake)
    assert live_data.osm_facilities(19.0, 73.0, 5)["count"] == 0
    assert seen == live_data.OVERPASS_MIRRORS[:2]  # stops at the first mirror that answers


def test_osm_all_mirrors_down_raises(monkeypatch):
    def down(*a, **k):
        raise live_data.LiveDataError("busy")

    monkeypatch.setattr(live_data, "_request", down)
    with pytest.raises(live_data.LiveDataError):
        live_data.osm_facilities(19.0, 73.0, 5)


# ---------------------------------------------------------------- network facilities

def test_nearest_network_facilities_sorted_flagged_synthetic_and_radius_filtered(synthetic_facility):
    stock = {"Paracetamol 500mg": {
        "resource_id": "paracetamol_500mg", "unit": "strip", "category": "general",
        "capacity": 200, "reorder_level": 50, "levels": [150] * 90,
    }}
    synthetic_facility("TEST-LIVE-NEAR", "PHC", stock, lat=-45.0, lon=-170.0)   # remote spot: unambiguous nearest
    synthetic_facility("TEST-LIVE-FAR", "PHC", stock, lat=-45.0, lon=-168.0)
    out = live_data.nearest_network_facilities(-45.0, -170.0, limit=2)
    assert [f["id"] for f in out["facilities"]] == ["TEST-LIVE-NEAR", "TEST-LIVE-FAR"]
    assert all(f["synthetic"] for f in out["facilities"])
    assert out["facilities"][0]["distance_km"] == 0
    within = live_data.nearest_network_facilities(-45.0, -170.0, limit=5, radius_km=50)
    assert [f["id"] for f in within["facilities"]] == ["TEST-LIVE-NEAR"]


# ---------------------------------------------------------------- HTTP layer

def test_router_returns_503_when_upstream_is_down():
    r = client.get("/api/live/weather", params={"lat": 18.5, "lon": 73.8})
    assert r.status_code == 503


def test_router_validates_coordinates_and_indicator():
    assert client.get("/api/live/weather", params={"lat": 123, "lon": 10}).status_code == 422
    assert client.get("/api/live/benchmarks", params={"indicator": "BOGUS"}).status_code == 400


def test_benchmark_catalog_needs_no_network():
    r = client.get("/api/live/benchmarks/catalog")
    assert r.status_code == 200
    ids = {i["id"] for i in r.json()["indicators"]}
    assert "SH.MED.BEDS.ZS" in ids and {"IND", "BRA"} <= {c["iso3"] for c in r.json()["countries"]}


def test_network_facilities_endpoint_works_offline():
    r = client.get("/api/live/facilities/network", params={"lat": 18.52, "lon": 73.85, "limit": 3})
    assert r.status_code == 200
    assert len(r.json()["facilities"]) == 3 and all(f["synthetic"] for f in r.json()["facilities"])


def test_disabled_flag_makes_every_feed_unavailable(monkeypatch):
    monkeypatch.undo()  # drop the autouse network stub so the real _request runs
    live_data.clear_cache()
    monkeypatch.setattr(live_data.settings, "live_data_enabled", False)
    with pytest.raises(live_data.LiveDataError, match="disabled"):
        live_data.place_snapshot(10.0, 10.0)


# ---------------------------------------------------------------- assistant

def test_assistant_context_includes_real_weather_when_available(monkeypatch):
    def fake(method, url, **kw):
        n = len(kw["params"]["latitude"].split(","))
        return [_raw_weather(20, 75, [40] * 7, temp=27.5) for _ in range(n)]

    monkeypatch.setattr(live_data, "_request", fake)
    ctx = assistant._build_context("Bihar")
    assert "Real weather forecast by state (Open-Meteo" in ctx
    assert "- Bihar:" in ctx and "27.5" in ctx


def test_assistant_context_omits_weather_when_feed_is_down():
    assert "Real weather forecast" not in assistant._build_context(None)


# ---------------------------------------------------------------- persistence + rate limits

@pytest.fixture
def persistent_cache(temp_db, monkeypatch):
    monkeypatch.setattr(live_data.settings, "live_cache_persist", True)
    return temp_db


def test_cache_survives_a_restart(persistent_cache, monkeypatch):
    calls = []

    def fake(method, url, **kw):
        calls.append(url)
        return {"results": [{"name": "Pune", "latitude": 18.5, "longitude": 73.8}]}

    monkeypatch.setattr(live_data, "_request", fake)
    live_data.geocode("Pune")
    live_data._CACHE.clear()  # what a process restart does to the in-memory cache
    assert live_data.geocode("Pune")["results"][0]["name"] == "Pune"
    assert len(calls) == 1  # second answer came from SQLite, not the network


def test_persisted_value_is_served_stale_when_upstream_is_down_after_restart(persistent_cache, monkeypatch):
    def fake(method, url, **kw):
        if "air-quality" in url:
            return {"current": {"us_aqi": 40, "pm2_5": 5.0, "pm10": 9.0, "time": "t"}}
        return _raw_weather(18.5, 73.8, [3] * 7)

    monkeypatch.setattr(live_data, "_request", fake)
    assert live_data.place_snapshot(18.5, 73.8)["stale"] is False
    live_data._CACHE.clear()

    def down(*a, **k):
        raise live_data.LiveDataError("down")

    monkeypatch.setattr(live_data, "_request", down)
    real_time = live_data.time.time
    monkeypatch.setattr(live_data.time, "time", lambda: real_time() + 10_000)
    assert live_data.place_snapshot(18.5, 73.8)["stale"] is True


def test_malformed_upstream_response_is_an_unavailable_feed_not_a_crash(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: {"unexpected": "shape"})
    with pytest.raises(live_data.LiveDataError, match="unexpected"):
        live_data.state_weather()
    assert client.get("/api/live/weather/states").status_code == 503


def test_simulation_reset_does_not_erase_real_cached_data(persistent_cache, real_db_reset):
    persistent_cache.live_cache_put("k", 1.0, {"a": 1})
    real_db_reset()  # runs against the temp DB the fixture installed
    assert persistent_cache.live_cache_get("k") == (1.0, {"a": 1})


def test_upstream_endpoints_are_rate_limited_per_ip():
    from app.routers import live

    statuses = [client.get("/api/live/facilities/network", params={"lat": 18.5, "lon": 73.8, "limit": 1}).status_code for _ in range(61)]
    assert statuses[:60] == [200] * 60
    assert statuses[60] == 429
    assert live.LIMIT_LIGHT == "60/minute"


# ---------------------------------------------------------------- facility count benchmarks (data.gov.in)

def _rhs_rows(*pairs):
    """pairs: (state, sub_centre, phcs, chcs)."""
    return {"records": [
        {"state_ut": st, "sub_centre": sc, "phcs": phc, "chcs": chc} for st, sc, phc, chc in pairs
    ]}


def test_facility_benchmarks_pairs_official_counts_with_this_networks_own(monkeypatch, synthetic_facility):
    synthetic_facility("TEST-FB-1", "PHC", {}, state="Maharashtra")
    synthetic_facility("TEST-FB-2", "PHC", {}, state="Maharashtra", district="Nashik", lat=20.0, lon=73.79)
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Maharashtra", 12522, 1624, 281)))

    out = live_data.facility_count_benchmarks(["Maharashtra"])
    row = out["states"][0]
    assert row["official"] == {"sub_centres": 12522, "phcs": 1624, "chcs": 281}
    assert row["network_facility_count"] >= 2  # at least the two synthetic facilities just added
    assert row["network_vs_official_phcs_pct"] is not None
    assert out["as_of"] == "March 2012"
    assert "data.gov.in" in out["source_url"]
    assert "historical snapshot" in out["disclaimer"]


def test_facility_benchmarks_strips_the_hash_suffix_some_state_names_carry(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Arunachal Pradesh#", 286, 97, 48)))
    out = live_data.facility_count_benchmarks(["Arunachal Pradesh"])
    assert out["states"][0]["state"] == "Arunachal Pradesh"


def test_facility_benchmarks_filters_to_the_requested_states_only(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(
        ("Maharashtra", 1, 2, 3), ("Kerala", 4, 5, 6), ("Bihar", 7, 8, 9),
    ))
    out = live_data.facility_count_benchmarks(["Maharashtra", "Kerala"])
    assert {s["state"] for s in out["states"]} == {"Maharashtra", "Kerala"}


def test_facility_benchmarks_defaults_to_every_state_the_feed_returns(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Maharashtra", 1, 2, 3), ("Kerala", 4, 5, 6)))
    out = live_data.facility_count_benchmarks()
    assert {s["state"] for s in out["states"]} == {"Maharashtra", "Kerala"}


def test_facility_benchmarks_has_no_network_count_for_a_state_the_demo_does_not_model(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Sikkim", 1, 2, 3)))
    out = live_data.facility_count_benchmarks(["Sikkim"])
    row = out["states"][0]
    assert row["network_facility_count"] is None
    assert row["network_vs_official_phcs_pct"] is None


def test_facility_benchmarks_raises_when_no_requested_state_matches(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Kerala", 1, 2, 3)))
    with pytest.raises(live_data.LiveDataError, match="no matching"):
        live_data.facility_count_benchmarks(["Nowhereistan"])


def test_facility_benchmarks_paginates_past_the_servers_capped_page_size(monkeypatch):
    # Mirrors the real API: `limit` is ignored, pages cap at 2 rows, and a
    # `total`/`count` envelope says how much more there is to fetch.
    all_rows = [
        {"state_ut": "Bihar", "sub_centre": 1, "phcs": 2, "chcs": 3},
        {"state_ut": "Kerala", "sub_centre": 4, "phcs": 5, "chcs": 6},
        {"state_ut": "Maharashtra", "sub_centre": 7, "phcs": 8, "chcs": 9},
    ]
    calls = []

    def fake(method, url, **kw):
        offset = kw["params"]["offset"]
        calls.append(offset)
        page = all_rows[offset:offset + 2]
        return {"records": page, "count": len(page), "total": len(all_rows), "limit": 2, "offset": offset}

    monkeypatch.setattr(live_data, "_request", fake)
    out = live_data.facility_count_benchmarks()
    assert calls == [0, 2]  # two pages needed to cover all 3 rows at a page size of 2
    assert {s["state"] for s in out["states"]} == {"Bihar", "Kerala", "Maharashtra"}


def test_facility_benchmarks_are_cached_for_a_day(monkeypatch):
    calls = []
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: (calls.append(1), _rhs_rows(("Kerala", 1, 2, 3)))[1])
    live_data.facility_count_benchmarks(["Kerala"])
    live_data.facility_count_benchmarks(["Kerala"])
    assert len(calls) == 1


def test_facility_benchmarks_request_sends_the_configured_api_key_as_a_query_param(monkeypatch):
    seen = {}

    def fake(method, url, **kw):
        seen["params"] = kw.get("params")
        return _rhs_rows(("Kerala", 1, 2, 3))

    monkeypatch.setattr(live_data, "_request", fake)
    monkeypatch.setattr(live_data.settings, "data_gov_in_api_key", "a-configured-key")
    live_data.facility_count_benchmarks(["Kerala"])
    assert seen["params"]["api-key"] == "a-configured-key"


def test_facility_benchmarks_endpoint_returns_503_when_the_feed_is_down():
    assert client.get("/api/live/facility-benchmarks").status_code == 503


def test_facility_benchmarks_endpoint_accepts_a_comma_separated_states_filter(monkeypatch):
    monkeypatch.setattr(live_data, "_request", lambda *a, **k: _rhs_rows(("Kerala", 1, 2, 3), ("Bihar", 4, 5, 6)))
    r = client.get("/api/live/facility-benchmarks", params={"states": "Kerala"})
    assert r.status_code == 200
    assert [s["state"] for s in r.json()["states"]] == ["Kerala"]


def test_default_api_key_is_data_gov_ins_own_published_sample_key():
    # Documented at https://api.data.gov.in/ as the public sample key — not a secret,
    # just the zero-setup default so this feature works with no configuration.
    from app.config import Settings

    assert Settings().data_gov_in_api_key == "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
