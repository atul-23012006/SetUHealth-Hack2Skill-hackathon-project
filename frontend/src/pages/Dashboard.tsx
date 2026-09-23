import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  WifiOff, Play, Square, AlertTriangle, FlaskConical, Waves, Bug, Microscope,
  Snowflake, Loader2, RotateCcw, Globe, Brain, Search, Building2, ExternalLink,
  BedDouble, UserCheck, BellRing,
} from "lucide-react";
import { api } from "../lib/api";
import { useCountUp } from "../lib/useCountUp";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import type {
  PHC, Forecast, RedistributionRec, Risk, ActiveCrisis,
  ConsumptionAnomaly, CapacityRecommendations,
} from "../lib/types";
import StatCard from "../components/StatCard";
import IndiaMap from "../components/IndiaMap";
import AlertsList from "../components/AlertsList";
import RedistributionList from "../components/RedistributionList";
import CountdownClock from "../components/CountdownClock";
import AnomalyList from "../components/AnomalyList";
import CapacityRedistributionList from "../components/CapacityRedistributionList";
import LiveSignalsPanel from "../components/LiveSignalsPanel";
import WeatherImpactPanel from "../components/WeatherImpactPanel";

// Animated number for panels that are not StatCards.
function CountUp({ value, thousands = false }: { value: string | number; thousands?: boolean }) {
  return <>{useCountUp(value, 1200, thousands)}</>;
}

const riskRank: Record<Risk, number> = { critical: 2, warning: 1, low: 0 };

const CRISIS_TYPE_ICONS: Record<string, typeof Waves> = {
  "Monsoon Floods": Waves,
  "Dengue Outbreak": Bug,
  "Malaria Outbreak": Microscope,
  "Cold Chain Failure": Snowflake,
};

function CrisisTypeIcon({ type, size, className }: { type: string; size: number; className?: string }) {
  const Icon = CRISIS_TYPE_ICONS[type] ?? AlertTriangle;
  return <Icon size={size} className={className} />;
}

const DEMO_STEPS = [
  { label: "1/5 — Resetting simulation to baseline..." },
  { label: "2/5 — Simulating Monsoon Floods in Bihar..." },
  { label: "3/5 — Recomputing stockout forecasts..." },
  { label: "4/5 — Co-pilot executing emergency resupply..." },
  { label: "5/5 — Verifying redistribution recommendations..." },
];

export default function Dashboard() {
  const { t } = useLang();
  const [phcs, setPhcs] = useState<PHC[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [alerts, setAlerts] = useState<Forecast[]>([]);
  const [recs, setRecs] = useState<RedistributionRec[]>([]);
  const [stateList, setStateList] = useState<Record<string, string[]>>({});
  const [activeCrises, setActiveCrises] = useState<ActiveCrisis[]>([]);
  const [medicines, setMedicines] = useState<any[]>([]);
  const [anomalies, setAnomalies] = useState<ConsumptionAnomaly[]>([]);
  const [capacity, setCapacity] = useState<CapacityRecommendations | null>(null);
  const [loading, setLoading] = useState(true);

  // Weather scenario: when on, alerts and recommendations are planned against the
  // real weather outlook. Read through a ref so loadData keeps a stable identity.
  const [weatherAdjusted, setWeatherAdjusted] = useState(false);
  const [weatherIntensity, setWeatherIntensity] = useState(1);
  const scenarioRef = useRef<{ intensity: number } | undefined>(undefined);
  scenarioRef.current = weatherAdjusted ? { intensity: weatherIntensity } : undefined;
  const [scenarioError, setScenarioError] = useState(false);

  // Online status tracking
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Demo mode state
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStepIdx, setDemoStepIdx] = useState(-1);
  const [demoLabel, setDemoLabel] = useState("");
  const demoStopRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      loadData(false);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("storage", () => loadData(false));

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [expandedMeds, setExpandedMeds] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const [targetType, setTargetType] = useState<"state" | "district">("district");
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [crisisType, setCrisisType] = useState("Monsoon Floods");
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = useCallback((showLoading = false) => {
    if (showLoading) setLoading(true);
    Promise.all([
      api.phcs(),
      api.forecastAll(),
      // A failing scenario (weather feed down) falls back to the baseline instead of blanking the page.
      api.alerts(undefined, 8, scenarioRef.current).catch(() => { setScenarioError(true); return api.alerts(undefined, 8); }),
      api.redistribution(undefined, undefined, undefined, scenarioRef.current).catch(() => { setScenarioError(true); return api.redistribution(); }),
      api.states(),
      api.activeCrises(),
      api.medicines(),
      api.anomalies(),
      api.capacityRedistribution(),
    ])
      .then(([p, f, a, r, s, ac, m, an, cap]) => {
        setPhcs(p);
        setForecasts(f);
        setAlerts(a);
        setRecs(r.slice(0, 8));
        setStateList(s);
        setActiveCrises(ac);
        setMedicines(m || []);
        setAnomalies(an || []);
        setCapacity(cap || null);

        const statesKeys = Object.keys(s);
        if (statesKeys.length > 0) {
          if (!selectedState || !statesKeys.includes(selectedState)) {
            setSelectedState(statesKeys[0]);
            const districts = s[statesKeys[0]] || [];
            if (districts.length > 0) setSelectedDistrict(districts[0]);
          }
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, [selectedState]);

  useEffect(() => { loadData(true); }, []);

  // Re-plan when the scenario switch or its strength changes (skipping the first render).
  const scenarioMounted = useRef(false);
  useEffect(() => {
    if (!scenarioMounted.current) { scenarioMounted.current = true; return; }
    setScenarioError(false);
    const id = setTimeout(() => loadData(false), 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherAdjusted, weatherIntensity]);

  // Auto-poll active crises every 5 seconds while a crisis is running
  useEffect(() => {
    if (activeCrises.length === 0) return;
    const interval = setInterval(async () => {
      try {
        const crises = await api.activeCrises();
        setActiveCrises(crises);
      } catch (_) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [activeCrises.length]);

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

  const medStateAggregates = useMemo(() => {
    const map: Record<
      string,
      Record<string, { total_current: number; total_capacity: number; criticalCount: number; warningCount: number; phcCount: number }>
    > = {};
    for (const f of forecasts) {
      const m = f.medicine;
      const st = f.state || "";
      if (!map[m]) map[m] = {};
      if (!map[m][st]) map[m][st] = { total_current: 0, total_capacity: 0, criticalCount: 0, warningCount: 0, phcCount: 0 };
      map[m][st].total_current += f.current_level ?? 0;
      map[m][st].total_capacity += f.capacity ?? 0;
      map[m][st].phcCount += 1;
      if (f.risk === "critical") map[m][st].criticalCount += 1;
      if (f.risk === "warning") map[m][st].warningCount += 1;
    }
    return map;
  }, [forecasts]);

  // SDG 3.8 Impact Metrics — computed from live forecast + redistribution data
  const sdgMetrics = useMemo(() => {
    const criticalPhcSet = new Set(forecasts.filter((f) => f.risk === "critical").map((f) => f.phc_id));
    const urgentRecs = recs.filter((r) => r.urgency === "critical" || r.urgency === "warning");
    const stockoutDaysPrevented = urgentRecs.reduce((sum, r) => {
      const recipForecast = forecasts.find((f) => f.phc_id === r.to_phc_id && f.medicine === r.medicine);
      return sum + (recipForecast?.days_to_stockout ?? 0);
    }, 0);
    const patientsAtRisk = criticalPhcSet.size * 2000;
    const coverageScore = phcs.length > 0 ? Math.round((1 - criticalPhcSet.size / phcs.length) * 100) : 100;
    return {
      criticalPhcs: criticalPhcSet.size,
      stockoutDaysPrevented: Math.round(stockoutDaysPrevented),
      patientsAtRisk,
      coverageScore,
    };
  }, [forecasts, recs, phcs]);

  // Top 3 most urgent countdown alerts
  const topAlerts = useMemo(() => {
    return [...alerts]
      .filter((a) => a.risk === "critical" && a.days_to_stockout != null && a.days_to_stockout > 0)
      .sort((a, b) => (a.days_to_stockout ?? 999) - (b.days_to_stockout ?? 999))
      .slice(0, 3);
  }, [alerts]);

  const handleToggleMed = (name: string) => {
    setExpandedMeds((s) => ({ ...s, [name]: !s[name] }));
  };

  const openStateModal = (medicine: string, state: string) => {
    navigate(`/medicines/${encodeURIComponent(medicine)}/states/${encodeURIComponent(state)}`);
  };

  // Real weather signal -> pre-fill the crisis simulator (never runs it).
  const [simFlash, setSimFlash] = useState(false);
  const loadSignalIntoSimulator = (state: string, crisis: string) => {
    setTargetType("state");
    setSelectedState(state);
    setCrisisType(crisis);
    document.getElementById("crisis-simulator")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSimFlash(true);
    setTimeout(() => setSimFlash(false), 2400);
  };

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

  // ---- Demo Mode ----
  const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

  const runDemo = useCallback(async () => {
    if (demoRunning) return;
    demoStopRef.current = false;
    setDemoRunning(true);

    const step = async (idx: number, action: () => Promise<void>, delay: number) => {
      if (demoStopRef.current) return;
      setDemoStepIdx(idx);
      setDemoLabel(DEMO_STEPS[idx].label);
      await sleep(delay);
      if (demoStopRef.current) return;
      await action();
    };

    try {
      // Step 0: Reset to clean state
      await step(0, () => api.resetCrisis().then(() => loadData(false)), 0);
      await sleep(2000);

      // Step 1: Trigger Monsoon Floods in Bihar
      await step(1, () => api.triggerCrisis("state", "Bihar", "Monsoon Floods").then(() => loadData(false)), 1500);
      await sleep(2500);

      // Step 2: Show forecast updating
      await step(2, async () => { loadData(false); }, 1000);
      await sleep(2500);

      // Step 3: Execute the top recommendation automatically
      await step(3, async () => {
        const freshRecs = await api.redistribution();
        if (freshRecs.length > 0) {
          const r = freshRecs[0];
          await api.executeTransfer(r.from_phc_id, r.to_phc_id, r.medicine, r.quantity);
          loadData(false);
        }
      }, 2000);
      await sleep(2500);

      // Step 4: Final refresh
      await step(4, async () => { loadData(false); }, 1500);
      await sleep(1500);

    } catch (e) {
      console.error("Demo failed", e);
    } finally {
      setDemoRunning(false);
      setDemoStepIdx(-1);
      setDemoLabel("");
    }
  }, [demoRunning, loadData]);

  const stopDemo = useCallback(() => {
    demoStopRef.current = true;
    setDemoRunning(false);
    setDemoStepIdx(-1);
    setDemoLabel("");
  }, []);

  const criticalCount = forecasts.filter((f) => f.risk === "critical").length;
  const warningCount = forecasts.filter((f) => f.risk === "warning").length;
  const avgBeds = phcs.length
    ? Math.round((phcs.reduce((s, p) => s + (p.beds_occupied ?? 0) / p.beds_total, 0) / phcs.length) * 100)
    : 0;
  const avgAttendance = phcs.length
    ? Math.round(phcs.reduce((s, p) => s + (p.attendance_pct ?? 0), 0) / phcs.length)
    : 0;

  if (loading) return <PageLoader label={t("loading")} />;

  return (
    <div className="space-y-6">
      {/* Demo Mode floating progress breadcrumb */}
      {demoRunning && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 max-w-md">
          <div className="flex gap-1.5 shrink-0">
            {DEMO_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  i === demoStepIdx
                    ? "bg-brand-400 scale-125"
                    : i < demoStepIdx
                    ? "bg-brand-600"
                    : "bg-slate-600"
                }`}
              />
            ))}
          </div>
          <span className="text-sm font-medium text-slate-200 truncate">{demoLabel || "Running demo..."}</span>
          <button
            onClick={stopDemo}
            className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-rose-600 border border-slate-600 transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm animate-pulse">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <WifiOff size={16} />
            <span>Offline Mode: Changes will queue locally and synchronize once network returns.</span>
          </div>
          <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-medium border border-amber-300">
            Disconnected
          </span>
        </div>
      )}

      {/* Hero */}
      <div
        id="dashboard-hero"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-950 via-slate-900 to-slate-950 p-6 text-white shadow-xl sm:p-8"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-16 -top-24 h-72 w-72 animate-blob rounded-full bg-brand-500/30 blur-3xl" />
          <div className="absolute -right-10 top-6 h-64 w-64 animate-blob-slow rounded-full bg-gold-400/20 blur-3xl" />
          <div className="bg-grid absolute inset-0" />
        </div>
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-brand-200 backdrop-blur">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              National supply intelligence
            </div>
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
              National PHC <span className="text-gradient">Dashboard</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Real-time supply intelligence across {phcs.length} primary health centres
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/15 px-3 py-1 text-rose-200">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> {criticalCount} critical
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> {warningCount} warning
              </span>
            </div>
          </div>
          <button
            id="demo-mode-btn"
            onClick={demoRunning ? stopDemo : runDemo}
            className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-5 py-3 text-sm font-semibold shadow-lg transition-all ${
              demoRunning
                ? "border border-rose-300/40 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
                : "bg-gradient-to-r from-gold-400 to-gold-500 text-slate-900 shadow-gold-500/30 hover:-translate-y-0.5 hover:from-gold-300 hover:to-gold-400"
            }`}
          >
            {demoRunning ? <Square size={15} /> : <Play size={15} />}
            {demoRunning ? "Stop Demo" : "Run Demo"}
          </button>
        </div>
      </div>

      {/* Critical Stockout Countdown Clocks */}
      {topAlerts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] font-bold text-rose-500 uppercase tracking-widest">
              <AlertTriangle size={12} /> Critical Stockout Countdowns
            </span>
            <span className="text-[10px] text-slate-400">— live ETA until medicine runs out</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {topAlerts.map((a, i) => (
              <CountdownClock
                key={i}
                daysToStockout={a.days_to_stockout}
                medicine={a.medicine}
                phcName={a.phc_name || a.phc_id}
                district={a.district}
                state={a.state}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active Crisis Alert Banner — shown prominently above everything when crises are active */}
      {activeCrises.length > 0 && (
        <div className="bg-rose-600 text-white rounded-xl px-5 py-4 shadow-lg border border-rose-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle size={28} className="animate-pulse shrink-0" />
            <div>
              <div className="font-bold text-base">Active Crisis Simulation</div>
              <div className="text-sm text-rose-100 mt-0.5">
                Forecasts updated · Redistribution recomputed · Stockout risk elevated
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {activeCrises.map((c, idx) => (
                  <span
                    key={idx}
                    className="inline-block bg-white/20 border border-white/30 text-white text-[11px] px-2 py-0.5 rounded-md font-semibold"
                  >
                    {c.crisis_type} — {c.target_name}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={handleReset}
            disabled={actionLoading}
            className="shrink-0 bg-white text-rose-700 font-bold text-sm px-4 py-2 rounded-lg hover:bg-rose-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {actionLoading ? "Resetting..." : (<><RotateCcw size={14} /> Reset Simulation</>)}
          </button>
        </div>
      )}

      {/* Crisis Simulator Panel */}
      <div id="crisis-simulator" className={`border rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 transition-all duration-500 ${
        simFlash ? "ring-2 ring-gold-400 shadow-glow " : ""
      }${activeCrises.length > 0 ? "bg-rose-50 border-rose-200" : "bg-slate-50 border-slate-200"}`}>
        <div className="space-y-1">
          <div className="font-semibold text-slate-800 flex items-center gap-1.5">
            <FlaskConical size={16} /> {t("crisisSimulator")}
          </div>
          <div className="text-xs text-slate-500">
            Inject a health emergency to see forecasts flip critical, stockouts accelerate, and redistribution recompute live.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as "state" | "district")}
            className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
          >
            <option value="district">{t("district")}</option>
            <option value="state">{t("states")}</option>
          </select>

          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
          >
            {Object.keys(stateList).map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>

          {targetType === "district" && selectedState && stateList[selectedState] && (
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="border border-slate-300 rounded-md text-xs px-2 py-1.5 bg-white font-medium"
            >
              {(stateList[selectedState] || []).map((dst) => (
                <option key={dst} value={dst}>{dst}</option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1.5 border border-slate-300 rounded-md bg-white pl-2">
            <CrisisTypeIcon type={crisisType} size={14} className="text-rose-600 shrink-0" />
            <select
              value={crisisType}
              onChange={(e) => setCrisisType(e.target.value)}
              className="text-xs py-1.5 pr-2 bg-transparent font-medium text-rose-700 border-none focus:outline-none"
            >
              <option value="Monsoon Floods">Monsoon Floods</option>
              <option value="Dengue Outbreak">Dengue Outbreak</option>
              <option value="Malaria Outbreak">Malaria Outbreak</option>
              <option value="Cold Chain Failure">Cold Chain Failure</option>
            </select>
          </div>

          <button
            id="trigger-crisis-btn"
            onClick={handleTriggerCrisis}
            disabled={actionLoading}
            className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 shadow-sm transition-all flex items-center gap-1.5"
          >
            {actionLoading ? (<><Loader2 size={14} className="animate-spin" /> Triggering...</>) : (<><AlertTriangle size={14} /> Simulate Outbreak</>)}
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

      {/* Stat Cards */}
      <div id="stat-cards" className="stagger grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label={t("totalPhcs")} value={phcs.length} icon={Building2} />
        <StatCard label={t("criticalAlerts")} value={criticalCount} tone="critical" icon={AlertTriangle} pulse={criticalCount > 0} />
        <StatCard label={t("warningAlerts")} value={warningCount} tone="warning" icon={BellRing} />
        <StatCard label={t("avgBedOccupancy")} value={`${avgBeds}%`} icon={BedDouble} />
        <StatCard label={t("avgAttendance")} value={`${avgAttendance}%`} tone="good" icon={UserCheck} />
      </div>

      <LiveSignalsPanel onLoadIntoSimulator={loadSignalIntoSimulator} />

      <WeatherImpactPanel applied={weatherAdjusted} onApply={setWeatherAdjusted} intensity={weatherIntensity} onIntensity={setWeatherIntensity} />

      {/* SDG 3.8 Impact Dashboard */}
      <div id="sdg-panel" className="bg-gradient-to-r from-brand-950 via-slate-900 to-slate-950 border border-brand-800/50 rounded-xl p-5 text-white shadow-lg">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="font-bold text-brand-300 text-base flex items-center gap-2">
              <Globe size={18} /> SDG 3.8 Impact Dashboard
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Universal Health Coverage — Live impact estimates based on current network state
            </div>
          </div>
          <a
            href="https://sdgs.un.org/goals/goal3"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-brand-400 hover:text-brand-300 border border-brand-800 px-2 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
          >
            UN SDG Goal 3 <ExternalLink size={10} />
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-2xl font-black text-rose-300"><CountUp value={sdgMetrics.criticalPhcs} /></div>
            <div className="text-xs text-slate-400 mt-1">Facilities at critical risk</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-2xl font-black text-orange-300"><CountUp value={sdgMetrics.patientsAtRisk} thousands /></div>
            <div className="text-xs text-slate-400 mt-1">Patients potentially at risk</div>
            <div className="text-[9px] text-slate-600 mt-0.5">Est. ~2,000 per critical PHC</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="text-2xl font-black text-amber-300"><CountUp value={sdgMetrics.stockoutDaysPrevented} /></div>
            <div className="text-xs text-slate-400 mt-1">Stockout-days preventable</div>
            <div className="text-[9px] text-slate-600 mt-0.5">Via pending transfer recommendations</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 border border-white/5">
            <div className="flex items-baseline gap-1 mb-2">
              <div className="text-2xl font-black text-brand-300"><CountUp value={`${sdgMetrics.coverageScore}%`} /></div>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5">
              <div
                className="bg-gradient-to-r from-brand-400 to-emerald-400 h-1.5 rounded-full transition-all duration-700"
                style={{ width: `${sdgMetrics.coverageScore}%` }}
              />
            </div>
            <div className="text-xs text-slate-400 mt-1">SDG 3.8 Coverage Score</div>
          </div>
        </div>
      </div>

      {/* Map + State List (pass recs for transfer arrows) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div id="national-map" className="lg:col-span-2 card p-2 h-[440px]">
          <IndiaMap phcs={phcs} riskByPhc={riskByPhc} recs={recs} />
        </div>
        <div id="state-list" className="card p-4 h-[440px] overflow-y-auto">
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
                    <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-semibold">{s.critical}</span>
                  )}
                  {s.warning > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{s.warning}</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Alerts + Redistribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="alerts-panel" className="card p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-700">{t("stockoutAlerts")}</div>
            {weatherAdjusted && (
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${scenarioError ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>
                {scenarioError ? t("impact.chip.unavailable") : t("impact.chip.scenario", { n: weatherIntensity.toFixed(2) })}
              </span>
            )}
          </div>
          <AlertsList alerts={alerts} />
        </div>
        <div id="redistribution-panel" className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-slate-700">{t("redistributionRecs")}{weatherAdjusted && !scenarioError && <span className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">{t("impact.chip.planned", { n: weatherIntensity.toFixed(2) })}</span>}</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded font-medium text-violet-600">
              <Brain size={11} /> AI explanations available
            </div>
          </div>
          <RedistributionList recs={recs} medicines={medicines} onTransferExecuted={() => loadData(false)} />
        </div>
      </div>

      {/* Consumption anomalies + capacity (beds/staff) redistribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="anomaly-panel" className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <Search size={14} /> {t("consumptionAnomalies")}
              </div>
              <div className="text-[11px] text-slate-400">{t("consumptionAnomaliesSub")}</div>
            </div>
            {anomalies.length > 0 && (
              <span className="text-[10px] text-rose-600 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded font-semibold">
                {anomalies.length} flagged
              </span>
            )}
          </div>
          <AnomalyList anomalies={anomalies} />
        </div>
        <div className="card p-4">
          <div className="mb-1">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Building2 size={14} /> {t("capacityRedistribution")}
            </div>
            <div className="text-[11px] text-slate-400">{t("capacityRedistributionSub")}</div>
          </div>
          <CapacityRedistributionList data={capacity} />
        </div>
      </div>

      {/* Medicines panel */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-slate-700">Medicines</div>
          <div className="text-xs text-slate-500">Reference priorities from backend</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicines.map((m) => (
            <div key={m.name} className="p-3 border rounded-md">
              <div className="flex items-start gap-3">
                <div>
                  <span
                    className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded"
                    style={{ backgroundColor: m.tier_color || "#ddd", color: "#fff" }}
                  >
                    {m.tier_badge || m.tier_title || ""}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-slate-800">{m.name}</div>
                  <div className="text-xs text-slate-500">
                    {m.unit} · {m.category} {m.seasonal ? `· ${m.seasonal}` : ""}
                  </div>
                  {m.tier_description && <div className="text-xs text-slate-600 mt-1">{m.tier_description}</div>}
                </div>
                <div className="shrink-0">
                  <button
                    onClick={() => handleToggleMed(m.name)}
                    className="text-xs px-2 py-1 rounded-md border bg-slate-50 text-slate-700"
                  >
                    {expandedMeds[m.name] ? "Hide states" : "Show states"}
                  </button>
                </div>
              </div>

              {expandedMeds[m.name] && (
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {Object.keys(stateList).map((st) => {
                    const agg = (medStateAggregates[m.name] || {})[st];
                    if (!agg) return null;
                    const pct = agg.total_capacity
                      ? Math.round((agg.total_current / agg.total_capacity) * 100)
                      : 0;
                    return (
                      <div
                        key={st}
                        className="flex items-center justify-between p-2 rounded-md hover:bg-slate-50 cursor-pointer"
                        onClick={() => openStateModal(m.name, st)}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800">{st}</div>
                          <div className="text-xs text-slate-500">
                            {agg.phcCount} PHCs · {agg.total_current} {m.unit} of {agg.total_capacity} capacity ({pct}%)
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {agg.criticalCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">
                              {agg.criticalCount}
                            </span>
                          )}
                          {agg.warningCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                              {agg.warningCount}
                            </span>
                          )}
                          <div className="text-xs text-slate-400">{pct}%</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
