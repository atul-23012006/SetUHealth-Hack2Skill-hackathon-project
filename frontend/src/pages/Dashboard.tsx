import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHC, Forecast, RedistributionRec, Risk } from "../lib/types";
import StatCard from "../components/StatCard";
import IndiaMap from "../components/IndiaMap";
import AlertsList from "../components/AlertsList";
import RedistributionList from "../components/RedistributionList";

const riskRank: Record<Risk, number> = { critical: 2, warning: 1, low: 0 };

export default function Dashboard() {
  const { t } = useLang();
  const [phcs, setPhcs] = useState<PHC[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [alerts, setAlerts] = useState<Forecast[]>([]);
  const [recs, setRecs] = useState<RedistributionRec[]>([]);
  const [stateList, setStateList] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.phcs(), api.forecastAll(), api.alerts(undefined, 8), api.redistribution(), api.states()]).then(
      ([p, f, a, r, s]) => {
        setPhcs(p);
        setForecasts(f);
        setAlerts(a);
        setRecs(r.slice(0, 8));
        setStateList(s);
        setLoading(false);
      }
    );
  }, []);

  const riskByPhc = useMemo(() => {
    const map: Record<string, Risk> = {};
    for (const f of forecasts) {
      const current = map[f.phc_id];
      if (!current || riskRank[f.risk] > riskRank[current]) map[f.phc_id] = f.risk;
    }
    return map;
  }, [forecasts]);

  const stateStats = useMemo(() => {
    return Object.keys(stateList).map((state) => {
      const statePhcs = phcs.filter((p) => p.state === state);
      const critical = statePhcs.filter((p) => riskByPhc[p.id] === "critical").length;
      const warning = statePhcs.filter((p) => riskByPhc[p.id] === "warning").length;
      return { state, count: statePhcs.length, critical, warning };
    });
  }, [stateList, phcs, riskByPhc]);

  const criticalCount = forecasts.filter((f) => f.risk === "critical").length;
  const warningCount = forecasts.filter((f) => f.risk === "warning").length;
  const avgBeds = phcs.length
    ? Math.round((phcs.reduce((s, p) => s + (p.beds_occupied ?? 0) / p.beds_total, 0) / phcs.length) * 100)
    : 0;
  const avgAttendance = phcs.length
    ? Math.round(phcs.reduce((s, p) => s + (p.attendance_pct ?? 0), 0) / phcs.length)
    : 0;

  if (loading) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={t("totalPhcs")} value={phcs.length} />
        <StatCard label={t("criticalAlerts")} value={criticalCount} tone="critical" />
        <StatCard label={t("warningAlerts")} value={warningCount} tone="warning" />
        <StatCard label={t("avgBedOccupancy")} value={`${avgBeds}%`} />
        <StatCard label={t("avgAttendance")} value={`${avgAttendance}%`} tone="good" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-2 h-[440px]">
          <IndiaMap phcs={phcs} riskByPhc={riskByPhc} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 h-[440px] overflow-y-auto">
          <div className="text-sm font-semibold text-slate-700 mb-3">{t("states")}</div>
          <div className="space-y-1">
            {stateStats.map((s) => (
              <Link
                key={s.state}
                to={`/states/${encodeURIComponent(s.state)}`}
                className="flex items-center justify-between px-2 py-2 rounded-md hover:bg-slate-50"
              >
                <span className="text-sm text-slate-800">{s.state}</span>
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400">{s.count} PHCs</span>
                  {s.critical > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">
                      {s.critical}
                    </span>
                  )}
                  {s.warning > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                      {s.warning}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("stockoutAlerts")}</div>
          <AlertsList alerts={alerts} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("redistributionRecs")}</div>
          <RedistributionList recs={recs} />
        </div>
      </div>
    </div>
  );
}
