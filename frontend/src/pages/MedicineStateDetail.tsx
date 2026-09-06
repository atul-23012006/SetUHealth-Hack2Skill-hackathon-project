import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHCDetail as PHCDetailType, Forecast } from "../lib/types";
import RiskBadge from "../components/RiskBadge";

export default function MedicineStateDetail() {
  const { medicine: rawMedicine, state: rawState } = useParams<{ medicine: string; state: string }>();
  const medicine = rawMedicine ? decodeURIComponent(rawMedicine) : "";
  const state = rawState ? decodeURIComponent(rawState) : "";
  const { t } = useLang();

  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);

  // selected PHC to show PHC-detail-like view
  const [selectedPhcId, setSelectedPhcId] = useState<string | null>(null);
  const [selectedPhcDetail, setSelectedPhcDetail] = useState<PHCDetailType | null>(null);
  const [selectedForecast, setSelectedForecast] = useState<Forecast | null>(null);

  useEffect(() => {
    if (!medicine || !state) return;
    setLoading(true);
    api.forecastAll()
      .then((allForecasts) => {
        // filter forecasts for this medicine & state
        const items = allForecasts.filter((f) => f.medicine === medicine && f.state === state);
        setForecasts(items);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [medicine, state]);

  useEffect(() => {
    if (!selectedPhcId) {
      setSelectedPhcDetail(null);
      setSelectedForecast(null);
      return;
    }
    // load PHC detail and find forecast for selected phc
    api.phc(selectedPhcId)
      .then((p) => setSelectedPhcDetail(p))
      .catch((err) => console.error(err));
    api.forecastAll()
      .then((all) => {
        const f = all.find((x) => x.phc_id === selectedPhcId && x.medicine === medicine);
        setSelectedForecast(f ?? null);
      })
      .catch((err) => console.error(err));
  }, [selectedPhcId, medicine]);

  const listItems = useMemo(() => {
    // join forecasts with PHC basic info
    return forecasts
      .map((f) => ({
        phc_id: f.phc_id,
        phc_name: f.phc_name,
        district: f.district,
        current_level: f.current_level,
        capacity: f.capacity,
        reorder_level: f.reorder_level,
        days_to_stockout: f.days_to_stockout,
        risk: f.risk,
      }))
      .sort((a, b) => {
        // sort by risk then days_to_stockout asc
        const rOrder = { critical: 0, warning: 1, low: 2 } as any;
        const ra = rOrder[a.risk] ?? 3;
        const rb = rOrder[b.risk] ?? 3;
        if (ra !== rb) return ra - rb;
        return (a.days_to_stockout ?? 9999) - (b.days_to_stockout ?? 9999);
      });
  }, [forecasts]);

  const stockChartData = useMemo(() => {
    if (!selectedPhcDetail || !medicine) return [];
    const rec = selectedPhcDetail.stock[medicine];
    if (!rec) return [];
    return selectedPhcDetail.dates.map((d, i) => ({ date: d.slice(5), level: rec.levels[i] }));
  }, [selectedPhcDetail, medicine]);

  const bedChartData = useMemo(() => {
    if (!selectedPhcDetail) return [];
    return selectedPhcDetail.dates.map((d, i) => ({ date: d.slice(5), occupied: selectedPhcDetail.bed_occupancy[i] }));
  }, [selectedPhcDetail]);

  const attendanceChartData = useMemo(() => {
    if (!selectedPhcDetail) return [];
    return selectedPhcDetail.dates.map((d, i) => ({ date: d.slice(5), pct: selectedPhcDetail.staff_attendance[i] }));
  }, [selectedPhcDetail]);

  const forecastChartData = useMemo(() => {
    if (!selectedForecast) return [];
    return selectedForecast.projection.map((level, i) => ({ day: `+${i + 1}`, level }));
  }, [selectedForecast]);

  if (!medicine || !state) return <div className="text-center text-slate-400 py-20">Invalid medicine or state</div>;
  if (loading) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-teal-600 hover:underline">
          ← {t("dashboard")}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{medicine} — {state}</h1>
        <div className="text-slate-500 text-sm">Aggregated statistics and PHC drilldowns for this medicine in the selected state</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 bg-white rounded-xl border border-slate-200 shadow-sm p-4 overflow-y-auto max-h-[600px]">
          <div className="text-sm font-semibold text-slate-700 mb-2">PHCs ({listItems.length})</div>
          <div className="divide-y divide-slate-100">
            {listItems.map((it) => (
              <div key={it.phc_id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{it.phc_name}</div>
                  <div className="text-xs text-slate-500">{it.district}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-400">{it.days_to_stockout ?? "—"} days</div>
                  <RiskBadge risk={it.risk as any} />
                  <button
                    className="text-xs px-2 py-1 rounded-md border bg-slate-50 text-slate-700"
                    onClick={() => setSelectedPhcId(it.phc_id)}
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          {selectedPhcDetail ? (
            <>
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold">{selectedPhcDetail.name}</h2>
                  <div className="text-xs text-slate-500">{selectedPhcDetail.district}, {selectedPhcDetail.state}</div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {selectedPhcDetail.staff.map((s) => (
                    <div key={s.role} className="bg-white rounded-xl border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">{s.role}</div>
                      <div className="text-lg font-bold text-slate-900">{s.sanctioned}</div>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-slate-700">Stock Levels ({medicine})</div>
                  </div>

                  {selectedForecast && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <RiskBadge risk={selectedForecast.risk} />
                      <span>
                        {selectedForecast.days_to_stockout === null ? "Stable" : `${selectedForecast.days_to_stockout} ${t("daysLeft")}`}
                      </span>
                      {selectedForecast.temperature !== undefined && selectedForecast.temperature !== null && (
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold flex items-center gap-1 ${
                          selectedForecast.cold_chain_alert
                            ? "bg-rose-100 text-rose-800 border border-rose-300 animate-pulse"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}>
                          ❄️ Cold Chain: {selectedForecast.temperature}°C
                          {selectedForecast.cold_chain_alert && " (ALERT: Exceeded 8.0°C)"}
                        </span>
                      )}
                    </div>
                  )}

                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={stockChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={9} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      {selectedPhcDetail && selectedPhcDetail.stock[medicine] && (
                        <ReferenceLine y={selectedPhcDetail.stock[medicine].reorder_level} stroke="#d97706" strokeDasharray="4 4" label={{ value: "reorder", fontSize: 10, fill: "#d97706" }} />
                      )}
                      <Line type="monotone" dataKey="level" stroke="#0d9488" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {forecastChartData.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-semibold text-slate-700">Forecast</div>
                      {selectedForecast?.forecast_method && (
                        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                          {selectedForecast.forecast_method === "exponential_smoothing"
                            ? "Holt's Exponential Smoothing"
                            : "Moving Average (fallback)"}
                        </span>
                      )}
                    </div>
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
                    <div className="text-sm font-semibold text-slate-700 mb-2">Bed Occupancy</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={bedChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={9} />
                        <YAxis tick={{ fontSize: 10 }} domain={[0, selectedPhcDetail.beds_total]} />
                        <Tooltip />
                        <Line type="monotone" dataKey="occupied" stroke="#4f46e5" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <div className="text-sm font-semibold text-slate-700 mb-2">Staff Attendance</div>
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
            </>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-sm text-slate-500">Select a PHC on the left to view detailed stats.</div>
          )}
        </div>
      </div>
    </div>
  );
}
