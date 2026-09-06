import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  LineChart, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHCDetail as PHCDetailType, Forecast } from "../lib/types";
import RiskBadge from "../components/RiskBadge";

export default function PHCDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const [phc, setPhc] = useState<PHCDetailType | null>(null);
  const [medicine, setMedicine] = useState<string>("");
  const [forecast, setForecast] = useState<Forecast | null>(null);

  useEffect(() => {
    if (!id) return;
    api.phc(id).then((p) => {
      setPhc(p);
      const first = Object.keys(p.stock)[0];
      setMedicine(first);
    });
  }, [id]);

  useEffect(() => {
    if (!id || !medicine) return;
    api.forecastAll().then((all) => {
      const f = all.find((x) => x.phc_id === id && x.medicine === medicine);
      setForecast(f ?? null);
    });
  }, [id, medicine]);

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

  if (!phc) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;
  const reorder = medicine ? phc.stock[medicine].reorder_level : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/states/${encodeURIComponent(phc.state)}`} className="text-sm text-teal-600 hover:underline">
          ← {phc.state}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{phc.name}</h1>
        <div className="text-slate-500 text-sm">{phc.district}, {phc.state}</div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {phc.staff.map((s) => (
          <div key={s.role} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="text-xs text-slate-500">{s.role}</div>
            <div className="text-lg font-bold text-slate-900">{s.sanctioned}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
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
                ❄️ Cold Chain: {forecast.temperature}°C
                {forecast.cold_chain_alert && " (ALERT: Exceeded 8.0°C)"}
              </span>
            )}
          </div>
        )}
        {forecast && forecast.surge_detected && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl p-3 flex gap-2.5 items-start shadow-sm animate-fade-in">
            <span className="text-base mt-0.5">⚠️</span>
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">{t("bedOccupancy")}</div>
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-2">{t("staffAttendance")}</div>
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
    </div>
  );
}
