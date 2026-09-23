"""Real-world data feeds: live weather and air quality, place search, World Bank
health-system benchmarks, and OpenStreetMap health facilities.

Guardrail 2 (never present synthetic data as real) cuts both ways. Everything
this module returns was fetched from a public API at request time and carries
its ``source``; the network's own facilities are the only synthetic thing here
and are flagged ``synthetic: True``. When a feed is down the caller gets a
``LiveDataError`` (the router turns it into a 503) — there is deliberately no
fabricated fallback, and no key is required for any source.

Weather-derived "signals" are transparent rule-of-thumb thresholds over real
forecast values, not epidemiological or hydrological predictions; each carries
the numbers that triggered it so a reader can judge it.
"""
import math
import statistics
import threading
import time
from typing import Callable

import httpx

from app.config import settings
from app.services import db, forecasting, geo, store

USER_AGENT = "SetuHealth/1.0 (hackathon demo; public-data client)"
HTTP_TIMEOUT_S = 6.0
OVERPASS_TIMEOUT_S = 9.0

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_AIR = "https://air-quality-api.open-meteo.com/v1/air-quality"
OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
WORLD_BANK = "https://api.worldbank.org/v2"
DATA_GOV_IN = "https://api.data.gov.in"
# State/UT-wise Sub-Centres/PHCs/CHCs "functioning as on March 2012" — Real
# government data (Ministry of Health & Family Welfare via NHM's Rural Health
# Statistics), but an old snapshot: shown as a historical reference point,
# dated explicitly, never as a live count. (A newer-looking "as on March 2011"
# sibling resource also exists on the catalog, but its field ids carry an
# `as_on_march_2011___` prefix instead of these plain ones — this one was
# picked for the stable field names, not because 2012 > 2011.)
FACILITY_COUNT_RESOURCE_ID = "c305c34e-d2d4-4aba-a0bd-a962912acf54"
FACILITY_COUNT_AS_OF = "March 2012"
# The sample API key silently caps each page at ~10 rows regardless of the
# `limit` param, so a dataset with more rows than that needs real pagination.
FACILITY_COUNT_MAX_PAGES = 10
# Public Overpass instances come and go and are often overloaded; tried in
# order, first success wins. (Measured responsive when this was written.)
OVERPASS_MIRRORS = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# BRICS members and partners, ISO3 -> name.
BRICS_COUNTRIES = {
    "BRA": "Brazil", "RUS": "Russia", "IND": "India", "CHN": "China", "ZAF": "South Africa",
    "EGY": "Egypt", "ETH": "Ethiopia", "IRN": "Iran", "ARE": "UAE", "IDN": "Indonesia",
}

# World Bank indicator id -> (label, unit, higher_is_better)
BENCHMARK_INDICATORS: dict[str, tuple[str, str, bool]] = {
    "SH.MED.BEDS.ZS": ("Hospital beds", "per 1,000 people", True),
    "SH.MED.PHYS.ZS": ("Physicians", "per 1,000 people", True),
    "SH.XPD.CHEX.GD.ZS": ("Health expenditure", "% of GDP", True),
    "SH.IMM.IDPT": ("DPT immunization", "% of children 12-23 months", True),
    "SP.DYN.LE00.IN": ("Life expectancy", "years", True),
    "SH.TBS.INCD": ("Tuberculosis incidence", "per 100,000 people", False),
    "SH.MLR.INCD.P3": ("Malaria incidence", "per 1,000 people at risk", False),
}


class LiveDataError(Exception):
    """A live feed is disabled or unreachable. Never raised for bad *input*."""


def _data_gov_in_records(resource_id: str, max_pages: int = 10) -> list[dict]:
    """All records for a resource, paginating past whatever page size the
    server actually honors (see FACILITY_COUNT_MAX_PAGES)."""
    records: list[dict] = []
    offset = 0
    for _ in range(max_pages):
        query = {"api-key": settings.data_gov_in_api_key, "format": "json", "limit": 200, "offset": offset}
        page = _request("GET", f"{DATA_GOV_IN}/resource/{resource_id}", params=query)
        got = page.get("records", [])
        records.extend(got)
        offset += len(got) or page.get("count", 0)
        total = page.get("total", len(records))
        if not got or len(records) >= total:
            break
    return records


# --------------------------------------------------------------------------
# HTTP + cache
# --------------------------------------------------------------------------

def _request(method: str, url: str, *, params=None, data=None, timeout: float = HTTP_TIMEOUT_S):
    """The single network seam: tests replace this function, and nothing else in
    the module touches the network."""
    if not settings.live_data_enabled:
        raise LiveDataError("live data is disabled (LIVE_DATA_ENABLED=false)")
    try:
        resp = httpx.request(
            method, url, params=params, data=data, timeout=timeout,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise LiveDataError(f"{url.split('/')[2]} unavailable: {type(exc).__name__}") from exc


_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_LOCK = threading.Lock()
# Anything older than this is never worth serving, even as a stale fallback.
_MAX_STALE_S = 7 * 24 * 3600


def _persist_get(key: str):
    if not settings.live_cache_persist:
        return None
    try:
        return db.live_cache_get(key)
    except Exception:  # a broken cache must never break a request
        return None


def _persist_put(key: str, fetched_at: float, value: object) -> None:
    if not settings.live_cache_persist:
        return
    try:
        db.live_cache_put(key, fetched_at, value)
    except Exception:
        pass


def _cached(key: str, ttl_s: float, producer: Callable[[], object]):
    """Serve fresh cache (memory, then SQLite so restarts keep it); on producer
    failure serve the last good value marked stale, so a flaky upstream degrades
    to slightly old real data instead of nothing. Only successes are cached."""
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
    if hit is None:
        hit = _persist_get(key)
        if hit is not None:
            with _CACHE_LOCK:
                _CACHE[key] = hit
    if hit and now - hit[0] < ttl_s:
        return hit[1]
    try:
        try:
            value = producer()
        except (KeyError, TypeError, AttributeError, IndexError, ValueError) as exc:
            # A 200 with an unexpected shape is an unavailable feed, not a crash.
            raise LiveDataError(f"unexpected upstream response ({type(exc).__name__})") from exc
    except LiveDataError:
        if hit and now - hit[0] < _MAX_STALE_S:
            stale = dict(hit[1]) if isinstance(hit[1], dict) else hit[1]
            if isinstance(stale, dict):
                stale["stale"] = True
            return stale
        raise
    with _CACHE_LOCK:
        _CACHE[key] = (now, value)
    _persist_put(key, now, value)
    return value


# --------------------------------------------------------------------------
# Real government facility counts (data.gov.in), vs. this network's own demo
# facilities — historical reference only, never presented as a live count.
# --------------------------------------------------------------------------

def facility_count_benchmarks(states: list[str] | None = None) -> dict:
    """Official state-wise Sub-Centre/PHC/CHC counts alongside how many
    facilities this demo network models for the same state, so the synthetic
    scale-down (see README: 10% of real counts, for demo speed) is visible
    rather than implied."""
    wanted = set(states) if states else None

    def produce():
        rows = _data_gov_in_records(FACILITY_COUNT_RESOURCE_ID, FACILITY_COUNT_MAX_PAGES)
        network_counts: dict[str, int] = {}
        for p in store.PHCS:
            network_counts[p["state"]] = network_counts.get(p["state"], 0) + 1

        out = []
        for r in rows:
            state = str(r.get("state_ut", "")).rstrip("#").strip()
            if wanted and state not in wanted:
                continue
            network = network_counts.get(state)
            official_phcs = r.get("phcs")
            entry = {
                "state": state,
                "official": {
                    "sub_centres": r.get("sub_centre"),
                    "phcs": official_phcs,
                    "chcs": r.get("chcs"),
                },
                "network_facility_count": network,
                "network_vs_official_phcs_pct": (
                    round(100 * network / official_phcs, 1)
                    if network is not None and isinstance(official_phcs, (int, float)) and official_phcs
                    else None
                ),
            }
            out.append(entry)
        if not out:
            raise LiveDataError("data.gov.in returned no matching state rows")
        out.sort(key=lambda e: e["state"])
        return {
            "source": "data.gov.in — Ministry of Health & Family Welfare / NHM Rural Health Statistics",
            "source_url": f"https://www.data.gov.in/resource/{FACILITY_COUNT_RESOURCE_ID}",
            "as_of": FACILITY_COUNT_AS_OF,
            "fetched_at": _now_iso(),
            "disclaimer": (
                "Official counts are a historical snapshot, not a live figure. "
                "This demo's own network is a synthetic, deliberately scaled-down dataset — "
                "the comparison is for scale/context, not a claim that either number is current."
            ),
            "states": out,
            "stale": False,
        }

    key = f"facility_counts:{','.join(sorted(wanted)) if wanted else 'all'}"
    return _cached(key, 24 * 3600, produce)


def clear_cache(persistent: bool = False) -> None:
    """Empty the in-memory cache; ``persistent=True`` also empties the SQLite copy."""
    with _CACHE_LOCK:
        _CACHE.clear()
    if persistent:
        db.live_cache_prune(time.time() + 1)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# --------------------------------------------------------------------------
# Weather + derived signals
# --------------------------------------------------------------------------

_WEATHER_PARAMS = {
    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m",
    "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
    "forecast_days": 7,
    "timezone": "auto",
}

_LEVEL_RANK = {"normal": 0, "elevated": 1, "high": 2}


def derive_signals(current: dict, daily: dict) -> list[dict]:
    """Rule-based operational signals from real weather values.

    Thresholds: IMD's daily rainfall classes (heavy >= 64.5 mm, very heavy >=
    115.6 mm); heat and vector-borne bands are common rules of thumb. They are
    deliberately simple and each signal states the numbers behind it.
    """
    rain = [v for v in daily.get("precipitation_sum", []) if v is not None]
    tmax = [v for v in daily.get("temperature_2m_max", []) if v is not None]
    tmin = [v for v in daily.get("temperature_2m_min", []) if v is not None]
    total = round(sum(rain), 1)
    peak = round(max(rain), 1) if rain else 0.0
    hottest = round(max(tmax), 1) if tmax else None
    mean_temp = round(statistics.fmean([(a + b) / 2 for a, b in zip(tmax, tmin)]), 1) if tmax and tmin else None
    humidity = current.get("relative_humidity_2m")

    signals = []

    if peak >= 115.6 or total >= 200:
        flood = ("high", "Monsoon Floods")
    elif peak >= 64.5 or total >= 100:
        flood = ("elevated", "Monsoon Floods")
    else:
        flood = ("normal", None)
    signals.append({
        "id": "flood", "label": "Heavy rain / flooding",
        "level": flood[0], "suggested_crisis": flood[1],
        "reason": (
            f"{total} mm forecast over 7 days, wettest day {peak} mm. "
            "High: a day >= 115.6 mm (IMD very heavy) or >= 200 mm in the week. "
            "Elevated: a day >= 64.5 mm (IMD heavy) or >= 100 mm in the week."
        ),
    })

    warm_wet = mean_temp is not None and 22 <= mean_temp <= 32 and humidity is not None
    if warm_wet and total >= 75 and humidity >= 70:
        vector = ("high", "Dengue Outbreak")
    elif warm_wet and total >= 25 and humidity >= 60:
        vector = ("elevated", "Dengue Outbreak")
    else:
        vector = ("normal", None)
    signals.append({
        "id": "vector", "label": "Mosquito-borne disease conditions",
        "level": vector[0], "suggested_crisis": vector[1],
        "reason": (
            f"Mean {mean_temp} °C, humidity {humidity}%, {total} mm rain: warm, humid, wet conditions favour mosquito breeding "
            "(a simplification, not a case forecast)."
        ) if mean_temp is not None else "Not enough forecast data.",
    })

    if hottest is not None and hottest >= 40:
        heat = ("high", "Cold Chain Failure")
    elif hottest is not None and hottest >= 36:
        heat = ("elevated", "Cold Chain Failure")
    else:
        heat = ("normal", None)
    signals.append({
        "id": "heat", "label": "Heat stress on cold chain",
        "level": heat[0], "suggested_crisis": heat[1],
        "reason": f"Hottest forecast day {hottest} °C; vaccines and insulin must stay at 2-8 °C.",
    })
    return signals


def _weather_entry(raw: dict) -> dict:
    current = raw.get("current") or {}
    daily = raw.get("daily") or {}
    signals = derive_signals(current, daily)
    level = max((s["level"] for s in signals), key=lambda lv: _LEVEL_RANK[lv])
    return {
        "lat": raw.get("latitude"),
        "lon": raw.get("longitude"),
        "current": {
            "temperature_c": current.get("temperature_2m"),
            "apparent_temperature_c": current.get("apparent_temperature"),
            "humidity_pct": current.get("relative_humidity_2m"),
            "precipitation_mm": current.get("precipitation"),
            "wind_kmh": current.get("wind_speed_10m"),
            "observed_at": current.get("time"),
        },
        "daily": [
            {"date": d, "rain_mm": r, "temp_max_c": hi, "temp_min_c": lo}
            for d, r, hi, lo in zip(
                daily.get("time", []), daily.get("precipitation_sum", []),
                daily.get("temperature_2m_max", []), daily.get("temperature_2m_min", []),
            )
        ],
        "rain_7d_mm": round(sum(v for v in daily.get("precipitation_sum", []) if v is not None), 1),
        "signals": signals,
        "level": level,
    }


def _fetch_weather(points: list[tuple[float, float]]) -> list[dict]:
    params = dict(_WEATHER_PARAMS)
    params["latitude"] = ",".join(f"{lat:.4f}" for lat, _ in points)
    params["longitude"] = ",".join(f"{lon:.4f}" for _, lon in points)
    raw = _request("GET", OPEN_METEO_FORECAST, params=params)
    rows = raw if isinstance(raw, list) else [raw]
    if len(rows) != len(points):
        raise LiveDataError("open-meteo returned an unexpected number of locations")
    return [_weather_entry(r) for r in rows]


def state_centroids() -> dict[str, tuple[float, float]]:
    """Mean coordinate of each state's facilities, derived from the dataset."""
    grouped: dict[str, list[tuple[float, float]]] = {}
    for p in store.PHCS:
        grouped.setdefault(p["state"], []).append((p["lat"], p["lon"]))
    return {
        st: (round(statistics.fmean(a for a, _ in pts), 3), round(statistics.fmean(b for _, b in pts), 3))
        for st, pts in sorted(grouped.items())
    }


def state_weather() -> dict:
    """Real weather + signals at every state's centroid (one upstream call)."""
    centroids = state_centroids()
    key = "state_weather:" + ";".join(f"{s}:{la}:{lo}" for s, (la, lo) in centroids.items())

    def produce():
        entries = _fetch_weather(list(centroids.values()))
        return {
            "source": "Open-Meteo (open-meteo.com), no API key",
            "fetched_at": _now_iso(),
            "states": [{"state": s, **e} for s, e in zip(centroids.keys(), entries)],
            "stale": False,
        }

    return _cached(key, 900, produce)


def place_snapshot(lat: float, lon: float) -> dict:
    """Weather + signals + air quality at one point."""
    key = f"place:{round(lat, 2)}:{round(lon, 2)}"

    def produce():
        weather = _fetch_weather([(lat, lon)])[0]
        air = None
        try:
            raw = _request("GET", OPEN_METEO_AIR, params={
                "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
                "current": "us_aqi,pm2_5,pm10", "timezone": "auto",
            })
            cur = raw.get("current") or {}
            aqi = cur.get("us_aqi")
            air = {
                "us_aqi": aqi, "pm2_5": cur.get("pm2_5"), "pm10": cur.get("pm10"),
                "category": _aqi_category(aqi), "observed_at": cur.get("time"),
            }
        except (LiveDataError, KeyError, TypeError, AttributeError):
            air = None  # weather alone is still useful; the UI shows "air quality unavailable"
        return {
            "source": "Open-Meteo (open-meteo.com), no API key",
            "fetched_at": _now_iso(),
            "point": {"lat": lat, "lon": lon},
            "weather": weather,
            "air": air,
            "stale": False,
        }

    return _cached(key, 900, produce)


def _aqi_category(aqi) -> str | None:
    if aqi is None:
        return None
    for limit, name in ((50, "Good"), (100, "Moderate"), (150, "Unhealthy for sensitive groups"),
                        (200, "Unhealthy"), (300, "Very unhealthy")):
        if aqi <= limit:
            return name
    return "Hazardous"


def weather_context_lines(state: str | None = None) -> list[str]:
    """One line per state for the assistant's prompt. Best effort: any feed
    problem yields no lines rather than an error."""
    try:
        data = state_weather()
    except LiveDataError:
        return []
    lines = []
    for s in data["states"]:
        if state and s["state"] != state:
            continue
        cur = s["current"]
        flags = [f"{sig['label']}: {sig['level']}" for sig in s["signals"] if sig["level"] != "normal"]
        lines.append(
            f"- {s['state']}: {cur['temperature_c']} °C, humidity {cur['humidity_pct']}%, "
            f"{s['rain_7d_mm']} mm rain forecast over 7 days"
            + (f" [{'; '.join(flags)}]" if flags else "")
        )
    return lines


# --------------------------------------------------------------------------
# Place search
# --------------------------------------------------------------------------

def geocode(query: str, country_code: str | None = "IN", count: int = 6) -> dict:
    query = query.strip()
    if len(query) < 2:
        return {"source": "Open-Meteo geocoding", "results": []}
    params = {"name": query, "count": count, "language": "en", "format": "json"}
    if country_code:
        params["country_code"] = country_code
    raw = _cached(
        f"geo:{country_code}:{query.lower()}", 3600,
        lambda: _request("GET", OPEN_METEO_GEOCODE, params=params),
    )
    return {
        "source": "Open-Meteo geocoding (open-meteo.com)",
        "results": [
            {
                "name": r.get("name"), "admin1": r.get("admin1"), "admin2": r.get("admin2"),
                "country": r.get("country"), "lat": r.get("latitude"), "lon": r.get("longitude"),
                "population": r.get("population"),
            }
            for r in (raw.get("results") or [])
        ],
    }


# --------------------------------------------------------------------------
# World Bank benchmarks
# --------------------------------------------------------------------------

def benchmark_catalog() -> dict:
    return {
        "source": "World Bank Open Data (data.worldbank.org), no API key",
        "indicators": [
            {"id": i, "label": lbl, "unit": unit, "higher_is_better": hib}
            for i, (lbl, unit, hib) in BENCHMARK_INDICATORS.items()
        ],
        "countries": [{"iso3": c, "name": n} for c, n in BRICS_COUNTRIES.items()],
    }


def benchmarks(indicator: str, countries: list[str] | None = None) -> dict:
    if indicator not in BENCHMARK_INDICATORS:
        raise ValueError(f"unknown indicator: {indicator}")
    wanted = [c for c in (countries or list(BRICS_COUNTRIES)) if c in BRICS_COUNTRIES]
    if not wanted:
        raise ValueError("no valid countries requested")
    label, unit, higher_is_better = BENCHMARK_INDICATORS[indicator]
    url = f"{WORLD_BANK}/country/{';'.join(wanted)}/indicator/{indicator}"

    def produce():
        raw = _request("GET", url, params={"format": "json", "per_page": 1000, "date": "2000:2030"})
        rows = raw[1] if isinstance(raw, list) and len(raw) > 1 and raw[1] else []
        series: dict[str, list[dict]] = {c: [] for c in wanted}
        for r in rows:
            iso, val = r.get("countryiso3code"), r.get("value")
            if iso in series and val is not None:
                series[iso].append({"year": int(r["date"]), "value": val})
        out = []
        for iso in wanted:
            pts = sorted(series[iso], key=lambda p: p["year"])
            out.append({
                "iso3": iso, "name": BRICS_COUNTRIES[iso], "series": pts,
                "latest": pts[-1] if pts else None,
            })
        return {
            "source": "World Bank Open Data (data.worldbank.org), no API key",
            "source_url": f"https://data.worldbank.org/indicator/{indicator}",
            "fetched_at": _now_iso(),
            "indicator": {"id": indicator, "label": label, "unit": unit, "higher_is_better": higher_is_better},
            "countries": out,
            "stale": False,
        }

    return _cached(f"wb:{indicator}:{','.join(wanted)}", 6 * 3600, produce)


# --------------------------------------------------------------------------
# OpenStreetMap health facilities (real)
# --------------------------------------------------------------------------

def osm_facilities(lat: float, lon: float, radius_km: float = 8.0, limit: int = 120) -> dict:
    radius_m = int(radius_km * 1000)
    query = (
        f'[out:json][timeout:20];('
        f'node["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat:.5f},{lon:.5f});'
        f'way["amenity"~"^(hospital|clinic|doctors)$"](around:{radius_m},{lat:.5f},{lon:.5f});'
        f');out center {limit * 2};'
    )

    def produce():
        last_error: LiveDataError | None = None
        for mirror in OVERPASS_MIRRORS:
            try:
                raw = _request("POST", mirror, data={"data": query}, timeout=OVERPASS_TIMEOUT_S)
                break
            except LiveDataError as exc:
                last_error = exc
        else:
            raise last_error or LiveDataError("overpass unavailable")
        items = []
        for el in raw.get("elements", []):
            tags = el.get("tags") or {}
            plat = el.get("lat") if el.get("lat") is not None else (el.get("center") or {}).get("lat")
            plon = el.get("lon") if el.get("lon") is not None else (el.get("center") or {}).get("lon")
            if plat is None or plon is None:
                continue
            kind = tags.get("amenity", "facility")
            items.append({
                "osm_id": f"{el['type']}/{el['id']}",
                "name": tags.get("name") or tags.get("name:en") or f"Unnamed {kind}",
                "kind": kind,
                "operator": tags.get("operator"),
                "lat": plat, "lon": plon,
                "distance_km": round(geo.haversine_km({"lat": lat, "lon": lon}, {"lat": plat, "lon": plon}), 2),
                "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}",
            })
        items.sort(key=lambda f: f["distance_km"])
        return {
            "source": "OpenStreetMap contributors via Overpass API (ODbL)",
            "fetched_at": _now_iso(),
            "center": {"lat": lat, "lon": lon}, "radius_km": radius_km,
            "count": len(items[:limit]), "facilities": items[:limit],
            "stale": False,
        }

    return _cached(f"osm:{round(lat, 2)}:{round(lon, 2)}:{radius_km}", 3600, produce)


# --------------------------------------------------------------------------
# The network's own (synthetic) facilities near a point
# --------------------------------------------------------------------------

_RISK_RANK = {"critical": 2, "warning": 1, "low": 0}


def nearest_network_facilities(lat: float, lon: float, limit: int = 12, radius_km: float | None = None) -> dict:
    worst: dict[str, dict] = {}
    for f in forecasting.forecast_all():
        w = worst.setdefault(f["phc_id"], {"risk": "low", "critical": 0, "warning": 0, "soonest": None})
        if _RISK_RANK[f["risk"]] > _RISK_RANK[w["risk"]]:
            w["risk"] = f["risk"]
        if f["risk"] == "critical":
            w["critical"] += 1
        elif f["risk"] == "warning":
            w["warning"] += 1
        d = f.get("days_to_stockout")
        if d is not None and (w["soonest"] is None or d < w["soonest"]):
            w["soonest"] = d

    here = {"lat": lat, "lon": lon}
    ranked = []
    for p in store.PHCS:
        dist = geo.haversine_km(here, p)
        if radius_km is not None and dist > radius_km:
            continue
        w = worst.get(p["id"], {"risk": "low", "critical": 0, "warning": 0, "soonest": None})
        ranked.append({
            "id": p["id"], "name": p["name"], "state": p["state"], "district": p["district"],
            "facility_type": p.get("facility_type", "PHC"),
            "lat": p["lat"], "lon": p["lon"], "distance_km": round(dist, 1),
            "risk": w["risk"], "critical_items": w["critical"], "warning_items": w["warning"],
            "soonest_stockout_days": w["soonest"],
            "synthetic": True,
        })
    ranked.sort(key=lambda f: f["distance_km"])
    return {
        "source": "SetuHealth network (synthetic demo dataset)",
        "center": {"lat": lat, "lon": lon},
        "count": len(ranked[:limit]),
        "facilities": ranked[:limit],
    }
