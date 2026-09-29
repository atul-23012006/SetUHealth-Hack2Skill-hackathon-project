import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  WifiOff, Play, Square, AlertTriangle, FlaskConical, Waves, Bug, Microscope,
  Snowflake, Loader2, RotateCcw, Brain, Building2,
  BedDouble, UserCheck, BellRing,
} from "lucide-react";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import type { PHC, Forecast, RedistributionRec, Risk, ActiveCrisis, CrisisImpact, CrisisSeverity, Medicine } from "../lib/types";
import StatCard from "../components/StatCard";
import IndiaMap from "../components/IndiaMap";
import AlertsList from "../components/AlertsList";
import RedistributionList from "../components/RedistributionList";
import CountdownClock from "../components/CountdownClock";

// Network vitals captured just before the first simulated crisis, so the stat
// cards can show exactly how far the simulation moved them.
type Kpis = { critical: number; warning: number; avgBeds: number; avgAttendance: number };

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

// Named points on the backend's continuous intensity scale (services/store.py
// INTENSITY_MIN..MAX = 0.25..2.0). A discrete Mild/Moderate/Severe choice is
// easier to reason about than a raw multiplier, without adding any new API.
const SEVERITY_LEVELS = [
  { label: "Mild", value: 0.5 },
  { label: "Moderate", value: 1.0 },
  { label: "Severe", value: 1.75 },
];

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
  const [crisisImpacts, setCrisisImpacts] = useState<CrisisImpact[]>([]);
  const [kpiBaseline, setKpiBaseline] = useState<Kpis | null>(null);
  const kpiRef = useRef<Kpis>({ critical: 0, warning: 0, avgBeds: 0, avgAttendance: 0 });
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);

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

  const [targetType, setTargetType] = useState<"state" | "district">("district");
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [crisisType, setCrisisType] = useState("Monsoon Floods");
  const [crisisIntensity, setCrisisIntensity] = useState(1);
  const [crisisSeverity, setCrisisSeverity] = useState<CrisisSeverity | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => { api.crisisSeverity().then(setCrisisSeverity).catch(() => {}); }, []);

  const loadData = useCallback((showLoading = false) => {
    if (showLoading) setLoading(true);
    Promise.all([
      api.phcs(),
      api.forecastAll(),
      api.alerts(undefined, 8),
      api.redistribution(),
      api.states(),
      api.activeCrises(),
      api.medicines(),
      api.crisisImpacts().catch(() => [] as CrisisImpact[]),
    ])
      .then(([p, f, a, r, s, ac, m, ci]) => {
        setPhcs(p);
        setForecasts(f);
        setAlerts(a);
        setRecs(r.slice(0, 8));
        setStateList(s);
        setActiveCrises(ac);
        setMedicines(m || []);
        setCrisisImpacts(ci);
        // Crises cleared elsewhere (another tab, a restart): drop the stale baseline.
        if (ac.length === 0 && ci.length === 0) setKpiBaseline(null);

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

  // Top 3 most urgent countdown alerts
  const topAlerts = useMemo(() => {
    return [...alerts]
      .filter((a) => a.risk === "critical" && a.days_to_stockout != null && a.days_to_stockout > 0)
      .sort((a, b) => (a.days_to_stockout ?? 999) - (b.days_to_stockout ?? 999))
      .slice(0, 3);
  }, [alerts]);

  // A real weather signal picked on Insights' Live Signals panel arrives here
  // as ?simState=&simCrisis= (that panel has no simulator of its own — see
  // Insights.tsx) and pre-fills the Crisis Simulator below, never running it.
  const [simFlash, setSimFlash] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const simState = params.get("simState");
    const simCrisis = params.get("simCrisis");
    if (!simState || !simCrisis) return;
    setTargetType("state");
    setSelectedState(simState);
    setCrisisType(simCrisis);
    window.history.replaceState(null, "", window.location.pathname);
    document.getElementById("crisis-simulator")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setSimFlash(true);
    setTimeout(() => setSimFlash(false), 2400);
  }, []);

  const handleTriggerCrisis = async () => {
    const targetName = targetType === "state" ? selectedState : selectedDistrict;
    if (!targetName) return;
    setActionLoading(true);
    // Keep the baseline from before the *first* crisis, so stacked crises add up.
    setKpiBaseline((b) => b ?? { ...kpiRef.current });
    try {
      await api.triggerCrisis(targetType, targetName, crisisType, crisisIntensity);
      loadData(false);
      document.getElementById("stat-cards")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error(err);
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
      alert(detail || "Failed to trigger crisis.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    setActionLoading(true);
    try {
      await api.resetCrisis();
      setKpiBaseline(null);
      setCrisisImpacts([]);
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
      await step(0, () => api.resetCrisis().then(() => { setKpiBaseline(null); setCrisisImpacts([]); loadData(false); }), 0);
      await sleep(2000);

      // Step 1: Trigger Monsoon Floods in Bihar
      await step(1, () => {
        setKpiBaseline({ ...kpiRef.current });
        return api.triggerCrisis("state", "Bihar", "Monsoon Floods").then(() => loadData(false));
      }, 1500);
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
  kpiRef.current = { critical: criticalCount, warning: warningCount, avgBeds, avgAttendance };
  const delta = (key: keyof Kpis, worseWhen: "up" | "down", suffix?: string) =>
    kpiBaseline ? { value: kpiRef.current[key] - kpiBaseline[key], worseWhen, suffix } : undefined;

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
          <div className="text-xs text-slate-500 max-w-md">
            Inject a health emergency to see forecasts flip critical, stockouts accelerate, and redistribution recompute live.
            {" "}Severity scales realistically — a mild simulation leaves real stock behind; facilities are affected unevenly, not identically.
          </div>
        </div>

        <div className="flex flex-col items-stretch md:items-end gap-2">
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

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" id="crisis-intensity">
            <span className="font-medium text-slate-700">Severity</span>
            <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="radiogroup" aria-label="Crisis severity">
              {SEVERITY_LEVELS.map((lvl) => (
                <button
                  key={lvl.label}
                  type="button"
                  role="radio"
                  aria-checked={crisisIntensity === lvl.value}
                  disabled={crisisType === "Cold Chain Failure"}
                  onClick={() => setCrisisIntensity(lvl.value)}
                  className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    crisisIntensity === lvl.value ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
            {crisisType === "Cold Chain Failure" ? (
              <span className="text-slate-400">A refrigeration failure is on/off — severity doesn't apply.</span>
            ) : crisisSeverity?.severity[crisisType] ? (
              <span className="text-slate-400" title={crisisSeverity.severity[crisisType].why}>
                At Moderate: ~{Math.round(crisisSeverity.severity[crisisType].stock_fraction * 100)}% of stock consumed
                {crisisSeverity.severity[crisisType].bed_fraction > 0 &&
                  `, beds close ~${Math.round(crisisSeverity.severity[crisisType].bed_fraction * 100)}% of the gap to full`}
                . Facilities vary ±25%.
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div id="stat-cards" className="stagger grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label={t("totalPhcs")} value={phcs.length} icon={Building2} />
        <StatCard label={t("criticalAlerts")} value={criticalCount} tone="critical" icon={AlertTriangle} pulse={criticalCount > 0} delta={delta("critical", "up")} />
        <StatCard label={t("warningAlerts")} value={warningCount} tone="warning" icon={BellRing} delta={delta("warning", "up")} />
        <StatCard label={t("avgBedOccupancy")} value={`${avgBeds}%`} icon={BedDouble} delta={delta("avgBeds", "up", " pts")} />
        <StatCard label={t("avgAttendance")} value={`${avgAttendance}%`} tone="good" icon={UserCheck} delta={delta("avgAttendance", "down", " pts")} />
      </div>

      {/* A simulated crisis's before/after detail, real weather signals, the weather
          what-if overlay, consumption anomalies, capacity redistribution, the SDG 3.8
          rollup and the medicines reference all moved to Insights/Federated — see
          frontend/src/pages/AGENTS.md. This keeps only what's needed to see, right
          now, what's short and who should send what. */}
      {crisisImpacts.length > 0 && (
        <Link
          to="/insights"
          id="crisis-impact-link"
          className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 hover:bg-rose-100 transition-colors"
        >
          <span className="flex items-center gap-2 font-medium">
            <FlaskConical size={15} /> See exactly what the last simulation changed
          </span>
          <span className="text-xs font-semibold">Open Insights →</span>
        </Link>
      )}

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
            <Link to="/insights" className="text-[10px] text-violet-600 hover:underline font-medium">
              Weather what-if scenario →
            </Link>
          </div>
          <AlertsList alerts={alerts} />
        </div>
        <div id="redistribution-panel" className="card p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="text-sm font-semibold text-slate-700">{t("redistributionRecs")}</div>
            <div className="flex items-center gap-1 text-[10px] text-slate-400 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded font-medium text-violet-600">
              <Brain size={11} /> AI explanations available
            </div>
          </div>
          <RedistributionList recs={recs} medicines={medicines} onTransferExecuted={() => loadData(false)} />
        </div>
      </div>
    </div>
  );
}
