import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Circle, CircleMarker, MapContainer, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle, CloudRain, Droplets, ExternalLink, Loader2, LocateFixed, MapPin, RefreshCw, Search, Thermometer, Wind,
} from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";
import type { GeocodeResult, NetworkFacility, OsmFacility, Risk, SignalLevel } from "../lib/types";
import BaseTiles from "../components/BaseTiles";
import RiskBadge from "../components/RiskBadge";

const DEFAULT_PLACE = { lat: 18.5196, lon: 73.8554, name: "Pune, Maharashtra" };
const QUICK_PICKS = [
  { name: "Pune, Maharashtra", lat: 18.5196, lon: 73.8554 },
  { name: "Patna, Bihar", lat: 25.5941, lon: 85.1356 },
  { name: "Jaipur, Rajasthan", lat: 26.9124, lon: 75.7873 },
  { name: "Kochi, Kerala", lat: 9.9312, lon: 76.2673 },
  { name: "Lucknow, Uttar Pradesh", lat: 26.8467, lon: 80.9462 },
  { name: "Chennai, Tamil Nadu", lat: 13.0827, lon: 80.2707 },
];

const RISK_COLOR: Record<Risk, string> = { critical: "#e11d48", warning: "#d97706", low: "#059669" };
const LEVEL_CHIP: Record<SignalLevel, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  elevated: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const AQI_CHIP: Record<string, string> = {
  Good: "bg-emerald-100 text-emerald-800",
  Moderate: "bg-yellow-100 text-yellow-800",
  "Unhealthy for sensitive groups": "bg-orange-100 text-orange-800",
  Unhealthy: "bg-rose-100 text-rose-800",
  "Very unhealthy": "bg-purple-100 text-purple-800",
  Hazardous: "bg-red-200 text-red-900",
};

function zoomFor(radiusKm: number) {
  return radiusKm <= 4 ? 13 : radiusKm <= 9 ? 12 : radiusKm <= 18 ? 11 : 10;
}

const pinIcon = L.divIcon({ className: "", html: '<div class="explore-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
const osmIcon = (kind: string, active: boolean) => {
  const size = kind === "hospital" ? 14 : 10;
  const ring = active ? "0 0 0 3px rgba(37,99,235,.45)" : "0 0 0 1px rgba(0,0,0,.25)";
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:#2563eb;border:2px solid #fff;border-radius:3px;box-shadow:${ring}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// Fly the map to a new centre, and pan (without re-zooming) to a hovered result.
function MapController({ center, zoom, focus }: { center: [number, number]; zoom: number; focus: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center[0], center[1], zoom]);
  useEffect(() => {
    if (focus) map.panTo(focus, { animate: true, duration: 0.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.[0], focus?.[1]]);
  return null;
}

function ClickToMove({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function ErrorNote({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  const { t } = useLang();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <AlertTriangle size={14} aria-hidden="true" />
      {t("explore.unavailable", { what, err: error })}
      <button onClick={onRetry} className="ml-auto rounded-md border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100">
        {t("common.retry")}
      </button>
    </div>
  );
}

export default function Explore() {
  const { t } = useLang();
  const [params, setParams] = useSearchParams();
  const lat = Number(params.get("lat")) || DEFAULT_PLACE.lat;
  const lon = Number(params.get("lon")) || DEFAULT_PLACE.lon;
  const name = params.get("name") || DEFAULT_PLACE.name;
  const rlat = Math.round(lat * 1e4) / 1e4;
  const rlon = Math.round(lon * 1e4) / 1e4;

  const setPlace = (p: { lat: number; lon: number; name: string }) =>
    setParams({ lat: p.lat.toFixed(4), lon: p.lon.toFixed(4), name: p.name });

  // ---- radius (debounced before it triggers the slower OpenStreetMap query)
  const [radius, setRadius] = useState(8);
  const [committedRadius, setCommittedRadius] = useState(8);
  useEffect(() => {
    const id = setTimeout(() => setCommittedRadius(radius), 450);
    return () => clearTimeout(id);
  }, [radius]);

  // ---- layers + hover sync between list and map
  const [showNetwork, setShowNetwork] = useState(true);
  const [showOsm, setShowOsm] = useState(true);
  const [showRadius, setShowRadius] = useState(true);
  const [tab, setTab] = useState<"network" | "osm">("network");
  const [active, setActive] = useState<string | null>(null);

  // ---- data (three independent feeds: one failing never blanks the others)
  const weather = useAsync(() => api.liveWeather(rlat, rlon), [rlat, rlon]);
  const network = useAsync(() => api.liveNetworkFacilities(rlat, rlon, 10), [rlat, rlon]);
  const osm = useAsync(() => api.liveOsmFacilities(rlat, rlon, committedRadius), [rlat, rlon, committedRadius]);

  // ---- place search with autocomplete
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(-1);
  const [focused, setFocused] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = setTimeout(() => {
      const seq = ++searchSeq.current;
      setSearching(true);
      api
        .liveGeocode(q)
        .then((r) => {
          if (seq !== searchSeq.current) return;
          setSuggestions(r);
          setSearchError(null);
          setHighlight(r.length ? 0 : -1);
        })
        .catch(() => seq === searchSeq.current && setSearchError(t("explore.searchError")))
        .finally(() => seq === searchSeq.current && setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const choose = (r: GeocodeResult) => {
    setPlace({ lat: r.lat, lon: r.lon, name: [r.name, r.admin1].filter(Boolean).join(", ") });
    setQuery("");
    setSuggestions([]);
  };

  const [geoState, setGeoState] = useState<"idle" | "asking" | "denied">("idle");
  const useMyLocation = () => {
    if (!navigator.geolocation) return setGeoState("denied");
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("idle");
        setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: t("explore.myLocation") });
      },
      () => setGeoState("denied"),
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  // Too-short queries show nothing; derived here rather than reset in an effect.
  const searchable = query.trim().length >= 2;
  const shownSuggestions = searchable ? suggestions : [];
  const shownSearchError = searchable ? searchError : null;

  const wx = weather.data?.weather;
  const netList = useMemo(() => network.data?.facilities ?? [], [network.data]);
  const osmList = useMemo(() => osm.data?.facilities ?? [], [osm.data]);
  const center: [number, number] = [rlat, rlon];

  const focusPoint = useMemo<[number, number] | null>(() => {
    if (!active) return null;
    const n = netList.find((f) => f.id === active);
    if (n) return [n.lat, n.lon];
    const o = osmList.find((f) => f.osm_id === active);
    return o ? [o.lat, o.lon] : null;
  }, [active, netList, osmList]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("explore.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          {t("explore.desc")}
        </p>
      </div>

      {/* Search row */}
      <div className="card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div id="explore-search" className="relative flex-1">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              role="combobox"
              aria-expanded={focused && shownSuggestions.length > 0}
              aria-controls="explore-suggestions"
              aria-label={t("explore.search.aria")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, shownSuggestions.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
                else if (e.key === "Enter" && shownSuggestions[highlight]) choose(shownSuggestions[highlight]);
                else if (e.key === "Escape") setSuggestions([]);
              }}
              placeholder={t("explore.search.placeholder")}
              className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-9 text-sm focus:border-brand-500 focus:outline-none"
            />
            {searching && <Loader2 size={15} aria-hidden="true" className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
            {focused && (shownSuggestions.length > 0 || shownSearchError) && (
              <ul
                id="explore-suggestions"
                role="listbox"
                className="animate-fade-in absolute z-[1000] mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              >
                {shownSearchError && <li className="px-3 py-2 text-xs text-amber-700">{shownSearchError}</li>}
                {shownSuggestions.map((r, i) => (
                  <li
                    key={`${r.lat},${r.lon}`}
                    role="option"
                    aria-selected={i === highlight}
                    onMouseDown={() => choose(r)}
                    onMouseEnter={() => setHighlight(i)}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === highlight ? "bg-brand-50" : ""}`}
                  >
                    <span>
                      <span className="font-medium text-slate-800">{r.name}</span>
                      <span className="text-slate-500">{[r.admin2, r.admin1].filter(Boolean).length ? ` · ${[r.admin2, r.admin1].filter(Boolean).join(", ")}` : ""}</span>
                    </span>
                    {r.population ? <span className="text-[11px] text-slate-400">{r.population.toLocaleString()}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            id="explore-locate"
            onClick={useMyLocation}
            disabled={geoState === "asking"}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {geoState === "asking" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <LocateFixed size={15} aria-hidden="true" />}
            {t("explore.locate")}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400">{t("explore.try")}</span>
          {QUICK_PICKS.map((q) => (
            <button
              key={q.name}
              onClick={() => setPlace(q)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                name === q.name ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {q.name.split(",")[0]}
            </button>
          ))}
          {geoState === "denied" && (
            <span className="ml-1 text-xs text-amber-700">{t("explore.geoDenied")}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Map column */}
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <Toggle on={showNetwork} onChange={setShowNetwork}>{t("explore.layer.network")}</Toggle>
            <Toggle on={showOsm} onChange={setShowOsm}>{t("explore.layer.osm")}</Toggle>
            <Toggle on={showRadius} onChange={setShowRadius}>{t("explore.layer.radius")}</Toggle>
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              {t("explore.layer.radius")}
              <input
                type="range" min={2} max={25} step={1} value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                aria-label={t("explore.radiusAria")}
                className="w-28 accent-brand-600"
              />
              <span className="w-12 font-semibold tabular-nums text-slate-800">{radius} km</span>
            </label>
          </div>

          <div id="explore-map" className="card relative h-[520px] overflow-hidden p-1">
            <MapContainer center={center} zoom={zoomFor(radius)} scrollWheelZoom className="h-full w-full rounded-xl">
              <BaseTiles />
              <MapController center={center} zoom={zoomFor(committedRadius)} focus={focusPoint} />
              <ClickToMove onPick={(la, lo) => setPlace({ lat: la, lon: lo, name: t("explore.dropped") })} />
              {showRadius && (
                <Circle center={center} radius={committedRadius * 1000} pathOptions={{ color: "#0d9488", weight: 1.5, dashArray: "6 6", fillOpacity: 0.05 }} />
              )}
              <Marker position={center} icon={pinIcon}>
                <Tooltip direction="top" offset={[0, -10]}>{name}</Tooltip>
              </Marker>

              {showOsm && osmList.map((f: OsmFacility) => (
                <Marker key={f.osm_id} position={[f.lat, f.lon]} icon={osmIcon(f.kind, active === f.osm_id)} eventHandlers={{ mouseover: () => setActive(f.osm_id), mouseout: () => setActive(null) }}>
                  <Tooltip direction="top">
                    <div className="text-xs">
                      <div className="font-semibold">{f.name}</div>
                      <div className="text-slate-500">{f.kind} · {f.distance_km} km · <span className="font-semibold text-emerald-700">{t("explore.tag.real")} (OSM)</span></div>
                    </div>
                  </Tooltip>
                </Marker>
              ))}

              {showNetwork && netList.map((f: NetworkFacility) => (
                <CircleMarker
                  key={f.id}
                  center={[f.lat, f.lon]}
                  radius={active === f.id ? 11 : f.risk === "critical" ? 8 : 6}
                  pathOptions={{ color: "#fff", weight: 2, fillColor: RISK_COLOR[f.risk], fillOpacity: 0.95 }}
                  eventHandlers={{ mouseover: () => setActive(f.id), mouseout: () => setActive(null) }}
                >
                  <Tooltip direction="top">
                    <div className="text-xs">
                      <div className="font-semibold">{f.name}</div>
                      <div className="text-slate-500">{f.risk} risk · {f.distance_km} km · <span className="font-semibold text-amber-700">{t("explore.tag.synthetic")}</span></div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="explore-pin !animate-none" style={{ width: 10, height: 10, borderWidth: 2 }} /> {t("explore.legend.pin")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-white bg-blue-600 shadow" /> {t("explore.legend.osm")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /><span className="h-2.5 w-2.5 rounded-full bg-amber-600" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> {t("explore.legend.network")}</span>
          </div>
        </div>

        {/* Side column */}
        <div className="space-y-4">
          <div id="explore-weather" className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <MapPin size={14} aria-hidden="true" className="text-brand-600" /> {name}
                </div>
                <div className="text-[11px] text-slate-400">{rlat.toFixed(3)}, {rlon.toFixed(3)}</div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("common.realData")}
              </span>
            </div>

            {weather.loading && !wx && <div className="skeleton mt-3 h-40" />}
            {weather.error && !wx && <div className="mt-3"><ErrorNote what={t("explore.what.weather")} error={weather.error} onRetry={weather.reload} /></div>}

            {wx && (
              <div className="mt-3 space-y-3">
                <div className="flex items-end justify-between">
                  <div className="text-4xl font-bold tabular-nums text-slate-900">
                    {wx.current.temperature_c ?? "–"}<span className="text-lg font-medium text-slate-400">°C</span>
                  </div>
                  <div className="space-y-0.5 text-right text-[11px] text-slate-500">
                    <div className="flex items-center justify-end gap-1"><Thermometer size={11} aria-hidden="true" /> {t("live.feels", { n: wx.current.apparent_temperature_c ?? "–" })}</div>
                    <div className="flex items-center justify-end gap-1"><Droplets size={11} aria-hidden="true" /> {wx.current.humidity_pct ?? "–"}%</div>
                    <div className="flex items-center justify-end gap-1"><Wind size={11} aria-hidden="true" /> {wx.current.wind_kmh ?? "–"} km/h</div>
                  </div>
                </div>

                {weather.data?.air ? (
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <span className="text-slate-500">{t("explore.air")}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${AQI_CHIP[weather.data.air.category ?? ""] ?? "bg-slate-100 text-slate-700"}`}>
                      {weather.data.air.us_aqi ?? "–"} · {weather.data.air.category ?? "n/a"}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">{t("explore.airNone")}</div>
                )}

                <div>
                  <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><CloudRain size={11} aria-hidden="true" /> {t("live.rain7")}</span>
                    <span className="font-semibold text-slate-700">{wx.rain_7d_mm} mm</span>
                  </div>
                  <div className="flex h-12 items-end gap-1">
                    {wx.daily.map((d) => {
                      const peak = Math.max(25, ...wx.daily.map((x) => x.rain_mm ?? 0));
                      return (
                        <div key={d.date} title={`${d.date}: ${d.rain_mm ?? 0} mm, high ${d.temp_max_c ?? "–"}°`}
                          className="w-full rounded-sm bg-gradient-to-t from-sky-500 to-sky-300 transition-all duration-700"
                          style={{ height: `${Math.max(6, ((d.rain_mm ?? 0) / peak) * 100)}%`, opacity: (d.rain_mm ?? 0) === 0 ? 0.25 : 1 }} />
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {wx.signals.map((g) => (
                    <div key={g.id} title={g.reason} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${LEVEL_CHIP[g.level]}`}>
                      <span>{t(`signal.${g.id}`)}</span>
                      <span className="uppercase tracking-wide">{t(`level.${g.level}`)}</span>
                    </div>
                  ))}
                  <p className="text-[10px] leading-snug text-slate-400">
                    {t("explore.signalHint")}
                    {weather.data?.stale ? " " + t("live.stale") : ""}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div id="explore-nearby" className="card p-4">
            <div className="mb-3 flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
              {(["network", "osm"] as const).map((tabKey) => (
                <button
                  key={tabKey}
                  onClick={() => setTab(tabKey)}
                  className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${tab === tabKey ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {tabKey === "network" ? t("explore.tab.network", { n: netList.length }) : t("explore.tab.osm", { n: osm.data?.count ?? "…" })}
                </button>
              ))}
            </div>

            <div className="max-h-[360px] space-y-1 overflow-y-auto pr-1">
              {tab === "network" && (
                <>
                  {network.loading && !network.data && <div className="skeleton h-40" />}
                  {network.error && <ErrorNote what={t("explore.what.network")} error={network.error} onRetry={network.reload} />}
                  {netList.map((f) => (
                    <div
                      key={f.id}
                      onMouseEnter={() => setActive(f.id)}
                      onMouseLeave={() => setActive(null)}
                      className={`rounded-lg border px-3 py-2 transition-colors ${active === f.id ? "border-brand-300 bg-brand-50" : "border-transparent hover:bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/phcs/${f.id}`} className="text-sm font-medium text-brand-700 hover:underline">{f.name}</Link>
                        <RiskBadge risk={f.risk} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                        <span>{t("explore.kmAway", { n: f.distance_km })} · {f.district}</span>
                        {f.soonest_stockout_days !== null && <span>{t("explore.firstStockout", { n: f.soonest_stockout_days })}</span>}
                        <span className="rounded bg-amber-50 px-1 font-semibold text-amber-700">{t("explore.tag.synthetic")}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {tab === "osm" && (
                <>
                  {osm.loading && !osm.data && (
                    <div className="space-y-2">
                      <div className="skeleton h-14" /><div className="skeleton h-14" /><div className="skeleton h-14" />
                      <p className="text-center text-[11px] text-slate-400">{t("explore.osm.loading")}</p>
                    </div>
                  )}
                  {osm.error && <ErrorNote what={t("explore.what.osm")} error={osm.error} onRetry={osm.reload} />}
                  {osmList.length === 0 && osm.data && (
                    <p className="py-6 text-center text-xs text-slate-400">{t("explore.osm.none", { n: osm.data.radius_km })}</p>
                  )}
                  {osmList.map((f) => (
                    <div
                      key={f.osm_id}
                      onMouseEnter={() => setActive(f.osm_id)}
                      onMouseLeave={() => setActive(null)}
                      className={`rounded-lg border px-3 py-2 transition-colors ${active === f.osm_id ? "border-blue-300 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">{f.name}</span>
                        <a href={f.osm_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.name} on OpenStreetMap`} className="shrink-0 text-slate-400 hover:text-blue-600">
                          <ExternalLink size={13} />
                        </a>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                        <span className="capitalize">{f.kind}</span>
                        <span>{t("explore.kmAway", { n: f.distance_km })}</span>
                        {f.operator && <span>{f.operator}</span>}
                        <span className="rounded bg-emerald-50 px-1 font-semibold text-emerald-700">{t("explore.tag.real")}</span>
                      </div>
                    </div>
                  ))}
                  {osm.data && (
                    <div className="flex items-center justify-between pt-2 text-[10px] text-slate-400">
                      <span>© OpenStreetMap contributors (ODbL){osm.data.stale ? " · last known data" : ""}</span>
                      <button onClick={osm.reload} className="inline-flex items-center gap-1 hover:text-slate-600"><RefreshCw size={10} aria-hidden="true" /> {t("common.refresh")}</button>
                    </div>
                  )}
                </>
              )}
            </div>
            <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-snug text-slate-400">
              {t("explore.footnote")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
