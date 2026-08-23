import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
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
    return forecast.projection.map((level, i) => ({ day: `+${i + 1}`, level }));
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
          <div className="mb-2 flex items-center gap-2 text-sm text-slate-600">
            <RiskBadge risk={forecast.risk} />
            <span>
              {forecast.days_to_stockout === null
                ? "Stable"
                : `${forecast.days_to_stockout} ${t("daysLeft")}`}
            </span>
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
          <div className="text-sm font-semibold text-slate-700 mb-2">{t("forecast")}</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={forecastChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="level" stroke="#dc2626" strokeWidth={2} dot={false} strokeDasharray="5 3" />
            </LineChart>
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
