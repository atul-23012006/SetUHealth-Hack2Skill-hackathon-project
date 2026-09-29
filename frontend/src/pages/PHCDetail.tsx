import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  LineChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";
import { Snowflake, AlertTriangle, CloudLightning, Receipt } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/useAsync";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import type {
  PHCDetail as PHCDetailType, Forecast, ConsumptionAnomaly, RedistributionRec,
  CapacityRecommendations, StateWeather, Medicine, SignalLevel, AuditEvent,
} from "../lib/types";
import RiskBadge from "../components/RiskBadge";
import AnomalyList from "../components/AnomalyList";
import RedistributionList from "../components/RedistributionList";
import CapacityRedistributionList from "../components/CapacityRedistributionList";

// Matches LiveSignalsPanel's chip styling (kept local — that file's version
// isn't exported, and this is the only other place a bare signal chip is
// needed, so a shared component would be a third file for two call sites).
const SIGNAL_CHIP: Record<SignalLevel, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  elevated: "border-amber-200 bg-amber-50 text-amber-700",
  normal: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

// Matches Transfers.tsx's KIND_STYLE (kept local for the same reason as
// SIGNAL_CHIP above). Only event kinds that can actually carry a phc_id
// (see db.log_event) will ever show up here — crisis/login/live_signal
// events never match a phc_id-scoped query.
const EVENT_KIND_STYLE: Record<string, string> = {
  transfer: "bg-brand-50 text-brand-700 border-brand-100",
  transfer_rejected: "bg-rose-50 text-rose-700 border-rose-100",
  transfer_attempted_offline: "bg-amber-50 text-amber-700 border-amber-100",
  dispatch: "bg-indigo-50 text-indigo-700 border-indigo-100",
};

export default function PHCDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const [phc, setPhc] = useState<PHCDetailType | null>(null);
  const [medicine, setMedicine] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);

  // Cross-links: everything else the platform already knows about this one
  // facility, computed elsewhere (anomaly detection, redistribution LP,
  // live weather) and re-shown here instead of only being reachable from
  // Insights/Dashboard. All requests are scoped to phc.state, so each is a
  // small, already-state-filtered payload, not the full national dataset.
  const [anomaly, setAnomalyState] = useState<ConsumptionAnomaly | null>(null);
  const [medicineRecs, setMedicineRecs] = useState<RedistributionRec[]>([]);
  const [capacityRecs, setCapacityRecs] = useState<CapacityRecommendations | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [stateWeather, setStateWeather] = useState<StateWeather | null>(null);
  const [history, setHistory] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoadError(null);
    api.phc(id).then((p) => {
      setPhc(p);
      const first = Object.keys(p.stock)[0];
      setMedicine(first);
    }).catch((err) => setLoadError(errorMessage(err)));
  }, [id]);

  useEffect(() => {
    if (!id || !medicine) return;
    api.forecastAll().then((all) => {
      const f = all.find((x) => x.phc_id === id && x.medicine === medicine);
      setForecast(f ?? null);
    });
  }, [id, medicine]);

  useEffect(() => {
    if (!id || !phc) return;
    const state = phc.state;
    api.anomalies(state).then((rows) => setAnomalyState(rows.find((a) => a.phc_id === id) ?? null));
    api.redistribution(state).then((recs) =>
      setMedicineRecs(recs.filter((r) => r.from_phc_id === id || r.to_phc_id === id))
    );
    api.capacityRedistribution(state).then((data) =>
      setCapacityRecs({
        beds: data.beds.filter((r) => r.from_phc_id === id || r.to_phc_id === id),
        staff: data.staff.filter((r) => r.from_phc_id === id || r.to_phc_id === id),
      })
    );
    api.medicines().then(setMedicines);
    api.liveStateWeather().then((res) => setStateWeather(res.states.find((s) => s.state === state) ?? null)).catch(() => setStateWeather(null));
  }, [id, phc]);

  useEffect(() => {
    if (!id) return;
    api.auditLog(50, id).then(setHistory).catch(() => setHistory([]));
  }, [id]);

  const activeSignals = useMemo(() => (stateWeather?.signals ?? []).filter((s) => s.level !== "normal"), [stateWeather]);

  const stockChartData = useMemo(() => {
    if (!phc || !medicine) return [];
    const rec = phc.stock[medicine];
    return phc.dates.map((d, i) => ({ date: d.slice(5), level: rec.levels[i] }));
  }, [phc, medicine]);

  const bedChartData = useMemo(() => {
    if (!phc) return [];
    return phc.dates.map((d, i) => ({ date: d.slice(5), occupied: phc.bed_occupancy[i] }));
  }, [phc]);

  const attendanceChartData = useMemo(() => {
    if (!phc) return [];
    return phc.dates.map((d, i) => ({ date: d.slice(5), pct: phc.staff_attendance[i] }));
  }, [phc]);

  const forecastChartData = useMemo(() => {
    if (!forecast) return [];
    return forecast.projection.map((level, i) => {
      const lower = forecast.forecast_lower?.[i] ?? level;
      const upper = forecast.forecast_upper?.[i] ?? level;
      return {
        day: `+${i + 1}`,
        level,
        lower,
        upper,
        // Stacked band: invisible base at `lower`, visible span of `upper - lower` on top
        bandBase: lower,
        bandSpan: Math.max(0, +(upper - lower).toFixed(1)),
      };
    });
  }, [forecast]);

  if (loadError && !phc) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {loadError}
        <Link to="/" className="ml-auto rounded-md border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100">
          {t("dashboard")}
        </Link>
      </div>
    );
  }
  if (!phc) return <PageLoader label={t("loading")} />;
  const reorder = medicine ? phc.stock[medicine].reorder_level : 0;

  return (
    <div className="space-y-6">
      <div id="phc-header">
        <Link to={`/states/${encodeURIComponent(phc.state)}`} className="text-sm text-brand-600 hover:underline">
          ← {phc.state}
        </Link>
        <h1 className="page-title mt-1">{phc.name}</h1>
        <div className="text-slate-500 text-sm">{phc.district}, {phc.state}</div>
      </div>

      <div id="phc-staff" className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
        {phc.staff.map((s) => (
          <div key={s.role} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">{s.role}</div>
            <div className="text-lg font-bold text-slate-900">{s.sanctioned}</div>
          </div>
        ))}
      </div>

      <div id="phc-stock" className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-slate-700">{t("stockLevels")}</div>
          <select
            value={medicine}
            onChange={(e) => setMedicine(e.target.value)}
            className="border border-slate-300 rounded-md text-sm px-2 py-1"
          >
            {Object.keys(phc.stock).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {forecast && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <RiskBadge risk={forecast.risk} />
            <span>
              {forecast.days_to_stockout === null
                ? "Stable"
                : `${forecast.days_to_stockout} ${t("daysLeft")}`}
            </span>
            {forecast.temperature !== undefined && forecast.temperature !== null && (
              <span className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${
                forecast.cold_chain_alert
                  ? "bg-rose-100 text-rose-800 border border-rose-300 animate-pulse"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                <Snowflake size={12} /> Cold Chain: {forecast.temperature}°C
                {forecast.cold_chain_alert && " (ALERT: Exceeded 8.0°C)"}
              </span>
            )}
          </div>
        )}
        {forecast && forecast.surge_detected && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl p-3 flex gap-2.5 items-start shadow-sm animate-fade-in">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              <h4 className="font-semibold text-rose-800 text-xs uppercase tracking-wider">{t("demandSurge")}</h4>
              <p className="text-xs text-rose-700 leading-relaxed">
                {t("surgeText")}
                <br />
                Recent Daily Consumption: <span className="font-bold">{forecast.daily_depletion_rate}</span> {forecast.unit}/day vs. Historical Baseline: <span className="font-bold">{forecast.baseline_rate}</span> {forecast.unit}/day.
              </p>
            </div>
          </div>
        )}
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={stockChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={9} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <ReferenceLine y={reorder} stroke="#d97706" strokeDasharray="4 4" label={{ value: "reorder", fontSize: 10, fill: "#d97706" }} />
            <Line type="monotone" dataKey="level" stroke="#0d9488" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {forecastChartData.length > 0 && (
        <div id="phc-forecast" className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-slate-700">{t("forecast")}</div>
            <div className="flex items-center gap-2">
              {forecast?.forecast_method && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                  {forecast.forecast_method === "exponential_smoothing"
                    ? "Holt's Exponential Smoothing"
                    : "Moving Average (fallback)"}
                </span>
              )}
              <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                ±1σ uncertainty band shown
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={forecastChartData}>
              <defs>
                <linearGradient id="ciGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={((val: number, name: string) => {
                  if (name === "upper") return [val, "Optimistic (−1σ demand)"];
                  if (name === "lower") return [val, "Pessimistic (+1σ demand)"];
                  if (name === "level") return [val, "Point forecast"];
                  return null;
                }) as never}
              />
              {/* ±1σ prediction band, drawn as an invisible base stacked with a visible span */}
              <Area
                type="monotone"
                dataKey="bandBase"
                stackId="ci"
                stroke="none"
                fill="none"
                fillOpacity={0}
                legendType="none"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="bandSpan"
                stackId="ci"
                stroke="none"
                fill="url(#ciGradient)"
                fillOpacity={1}
                legendType="none"
                isAnimationActive={false}
              />
              {/* Hidden series so the tooltip can report both bounds */}
              <Line type="monotone" dataKey="upper" stroke="none" dot={false} legendType="none" />
              <Line type="monotone" dataKey="lower" stroke="none" dot={false} legendType="none" />
              {/* Point forecast line */}
              <Line
                type="monotone"
                dataKey="level"
                stroke="#dc2626"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 3"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div id="phc-capacity" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">
            {t("bedOccupancy")} ({phc.dates.length} {t("days")})
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={bedChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={9} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, phc.beds_total]} />
              <Tooltip />
              <Line type="monotone" dataKey="occupied" stroke="#4f46e5" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">
            {t("staffAttendance")} ({phc.dates.length} {t("days")})
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={attendanceChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={9} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="pct" stroke="#059669" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Everything else the platform currently knows about this one facility —
          computed by the same engines Insights/Dashboard show network-wide,
          filtered here to just this phc_id so an officer investigating one
          place doesn't have to go hunting across pages for it. */}
      <div id="phc-anomaly" className="card p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("phcHub.anomaly.title")}</div>
        {anomaly ? (
          <AnomalyList anomalies={[anomaly]} />
        ) : (
          <div className="text-sm text-slate-400 py-4 text-center">{t("phcHub.anomaly.none")}</div>
        )}
      </div>

      <div id="phc-redistribution" className="card p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("phcHub.redistribution.title")}</div>
        {medicineRecs.length > 0 ? (
          <RedistributionList recs={medicineRecs} medicines={medicines} />
        ) : (
          <div className="text-sm text-slate-400 py-4 text-center">{t("phcHub.redistribution.none")}</div>
        )}
      </div>

      <div id="phc-capacity-recs" className="card p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("phcHub.capacity.title")}</div>
        {capacityRecs && (capacityRecs.beds.length > 0 || capacityRecs.staff.length > 0) ? (
          <CapacityRedistributionList data={capacityRecs} />
        ) : (
          <div className="text-sm text-slate-400 py-4 text-center">{t("phcHub.capacity.none")}</div>
        )}
      </div>

      <div id="phc-weather" className="card p-4">
        <div className="flex items-center justify-between mb-1 gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <CloudLightning size={14} className="text-violet-600" aria-hidden="true" />
            {t("phcHub.weather.title", { state: phc.state })}
          </div>
          <Link to="/insights" className="shrink-0 text-[11px] text-violet-600 hover:underline font-medium">
            {t("phcHub.weather.viewAll")}
          </Link>
        </div>
        {activeSignals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {activeSignals.map((s) => (
              <span
                key={s.id}
                title={s.reason}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${SIGNAL_CHIP[s.level]}`}
              >
                {s.label}: {s.level}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-400 py-4 text-center">
            {t("phcHub.weather.none", { state: phc.state })}
          </div>
        )}
      </div>

      <div id="phc-history" className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Receipt size={14} aria-hidden="true" /> {t("phcHub.history.title")}
          </div>
          {history && history.length > 0 && (
            <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded font-medium">
              {history.length} {history.length === 1 ? "event" : "events"}
            </span>
          )}
        </div>
        {history === null ? (
          <div className="text-sm text-slate-400 py-4 text-center">{t("loading")}</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">{t("phcHub.history.none")}</div>
        ) : (
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {history.map((e, i) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-slate-300 border-2 border-white" />
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                      EVENT_KIND_STYLE[e.kind] || "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {e.kind}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(e.ts).toLocaleString()}</span>
                </div>
                <div className="text-sm text-slate-700 mt-0.5">{e.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
