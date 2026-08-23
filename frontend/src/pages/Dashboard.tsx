import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHC, Forecast, RedistributionRec, Risk, ActiveCrisis } from "../lib/types";
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
  const [activeCrises, setActiveCrises] = useState<ActiveCrisis[]>([]);
  const [loading, setLoading] = useState(true);

  // Crisis form state
  const [targetType, setTargetType] = useState<"state" | "district">("district");
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [crisisType, setCrisisType] = useState("Dengue Outbreak");
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = (showLoading = false) => {
    if (showLoading) setLoading(true);
    Promise.all([
      api.phcs(),
      api.forecastAll(),
      api.alerts(undefined, 8),
      api.redistribution(),
      api.states(),
      api.activeCrises(),
    ])
      .then(([p, f, a, r, s, ac]) => {
        setPhcs(p);
        setForecasts(f);
        setAlerts(a);
        setRecs(r.slice(0, 8));
        setStateList(s);
        setActiveCrises(ac);

        // Auto-select first state and district if empty
        const statesKeys = Object.keys(s);
        if (statesKeys.length > 0) {
          if (!selectedState || !statesKeys.includes(selectedState)) {
            setSelectedState(statesKeys[0]);
            const districts = s[statesKeys[0]] || [];
            if (districts.length > 0) {
              setSelectedDistrict(districts[0]);
            }
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData(true);
  }, []);

  // Update district dropdown when state changes
  useEffect(() => {
    if (selectedState && stateList[selectedState]) {
      const districts = stateList[selectedState];
      if (districts.length > 0 && !districts.includes(selectedDistrict)) {
        setSelectedDistrict(districts[0]);
      }
    }
  }, [selectedState, stateList]);

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

  const handleTriggerCrisis = async () => {
    const targetName = targetType === "state" ? selectedState : selectedDistrict;
    if (!targetName) return;

    setActionLoading(true);
    try {
      await api.triggerCrisis(targetType, targetName, crisisType);
      loadData(false);
    } catch (err) {
      console.error(err);
      alert("Failed to trigger crisis.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    setActionLoading(true);
    try {
      await api.resetCrisis();
      loadData(false);
    } catch (err) {
      console.error(err);
      alert("Failed to reset database.");
    } finally {
      setActionLoading(false);
    }
  };

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
      {/* Crisis Simulator Panel */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <span>🚨 {t("crisisSimulator")}</span>
            {activeCrises.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-700 animate-pulse border border-rose-200">
                {activeCrises.length} {t("activeCrisesLabel")}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            Inject health emergencies to simulate stockouts, bed surges, and redistribution triggers.
          </div>
          {activeCrises.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {activeCrises.map((c, idx) => (
                <span
                  key={idx}
                  className="inline-block bg-rose-50 border border-rose-100 text-rose-800 text-[10px] px-2 py-0.5 rounded-md font-medium"
                >
                  {c.crisis_type} ({c.target_name})
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Target Type Selector */}
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as "state" | "district")}
            className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
          >
            <option value="district">{t("district")}</option>
            <option value="state">{t("states")}</option>
          </select>

          {/* State Selector */}
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
          >
            {Object.keys(stateList).map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {/* District Selector (conditional) */}
          {targetType === "district" && selectedState && stateList[selectedState] && (
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
            >
              {(stateList[selectedState] || []).map((dst) => (
                <option key={dst} value={dst}>
                  {dst}
                </option>
              ))}
            </select>
          )}

          {/* Crisis Type Selector */}
          <select
            value={crisisType}
            onChange={(e) => setCrisisType(e.target.value)}
            className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium text-rose-700"
          >
            <option value="Dengue Outbreak">Dengue Outbreak</option>
            <option value="Malaria Outbreak">Malaria Outbreak</option>
            <option value="Monsoon Floods">Monsoon Floods</option>
          </select>

          <button
            onClick={handleTriggerCrisis}
            disabled={actionLoading}
            className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
          >
            {actionLoading ? "..." : t("trigger")}
          </button>

          {activeCrises.length > 0 && (
            <button
              onClick={handleReset}
              disabled={actionLoading}
              className="bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-50"
            >
              {t("reset")}
            </button>
          )}
        </div>
      </div>

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
          <RedistributionList recs={recs} onTransferExecuted={() => loadData(false)} />
        </div>
      </div>
    </div>
  );
}
