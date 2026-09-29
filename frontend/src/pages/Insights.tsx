import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Building2 } from "lucide-react";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import type { CrisisImpact, ConsumptionAnomaly, CapacityRecommendations, Medicine } from "../lib/types";
import AnomalyList from "../components/AnomalyList";
import CapacityRedistributionList from "../components/CapacityRedistributionList";
import LiveSignalsPanel from "../components/LiveSignalsPanel";
import WeatherImpactPanel from "../components/WeatherImpactPanel";
import CrisisImpactPanel from "../components/CrisisImpactPanel";

// Everything here is supplementary to the Dashboard's daily triage view:
// scenario tooling (crisis-impact history, real weather signals, the weather
// what-if overlay), secondary operational signals (consumption anomalies,
// bed/staff capacity redistribution), and reference data (the medicines
// catalogue). None of it changes what the Dashboard needs to show first —
// see frontend/src/pages/AGENTS.md before moving anything back or further.
export default function Insights() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [crisisImpacts, setCrisisImpacts] = useState<CrisisImpact[]>([]);
  const [anomalies, setAnomalies] = useState<ConsumptionAnomaly[]>([]);
  const [capacity, setCapacity] = useState<CapacityRecommendations | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [stateList, setStateList] = useState<Record<string, string[]>>({});
  const [expandedMeds, setExpandedMeds] = useState<Record<string, boolean>>({});

  // Weather scenario — identical contract to the old Dashboard copy.
  const [weatherAdjusted, setWeatherAdjusted] = useState(false);
  const [weatherIntensity, setWeatherIntensity] = useState(1);

  const loadData = useCallback((showLoading = false) => {
    if (showLoading) setLoading(true);
    Promise.all([
      api.crisisImpacts().catch(() => [] as CrisisImpact[]),
      api.anomalies(),
      api.capacityRedistribution(),
      api.medicines(),
      api.states(),
    ])
      .then(([ci, an, cap, m, s]) => {
        setCrisisImpacts(ci);
        setAnomalies(an || []);
        setCapacity(cap || null);
        setMedicines(m || []);
        setStateList(s);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  useEffect(() => { loadData(true); }, [loadData]);

  const handleToggleMed = (name: string) => {
    setExpandedMeds((s) => ({ ...s, [name]: !s[name] }));
  };

  if (loading) return <PageLoader label={t("loading")} />;

  return (
    <div className="space-y-6">
      <div id="insights-header">
        <h1 className="page-title">Insights</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Scenario tools and secondary signals: what past simulated crises changed, real weather turned into a
          demand scenario, consumption anomalies, capacity redistribution, and the medicines reference.
        </p>
      </div>

      {crisisImpacts.length > 0 ? (
        <CrisisImpactPanel key={crisisImpacts.length} impacts={crisisImpacts} />
      ) : (
        <div className="card p-4 text-sm text-slate-400 text-center">
          No simulated crisis this session yet — trigger one from the Dashboard's Crisis Simulator to see its
          before/after impact here.
        </div>
      )}

      <LiveSignalsPanel onLoadIntoSimulator={(state, crisis) => {
        // This page has no crisis simulator of its own (it lives on the
        // Dashboard, tied to the stat cards it recomputes). Hand the pick
        // over via the URL so the Dashboard can still pre-fill and scroll to
        // it, instead of just dropping the operator's choice.
        navigate(`/?simState=${encodeURIComponent(state)}&simCrisis=${encodeURIComponent(crisis)}`);
      }} />

      <WeatherImpactPanel applied={weatherAdjusted} onApply={setWeatherAdjusted} intensity={weatherIntensity} onIntensity={setWeatherIntensity} />

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
        <div id="capacity-panel" className="card p-4">
          <div className="mb-1">
            <div className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Building2 size={14} /> {t("capacityRedistribution")}
            </div>
            <div className="text-[11px] text-slate-400">{t("capacityRedistributionSub")}</div>
          </div>
          <CapacityRedistributionList data={capacity} />
        </div>
      </div>

      <div id="medicines-panel" className="card p-4">
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
                  {Object.keys(stateList).map((st) => (
                    <MedStateRow key={st} medicine={m.name} state={st} unit={m.unit} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Per-(medicine, state) aggregate, fetched on demand when a medicine card is
// expanded — the old Dashboard copy derived this from forecasts it already
// held for the whole network; this page doesn't hold that dataset, so it asks
// the backend for just the one state/medicine slice being shown.
function MedStateRow({ medicine, state, unit }: { medicine: string; state: string; unit: string }) {
  const [agg, setAgg] = useState<{
    total_current: number; total_capacity: number; criticalCount: number; warningCount: number; phcCount: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.forecastAll(state).then((forecasts) => {
      if (cancelled) return;
      const rows = forecasts.filter((f) => f.medicine === medicine);
      if (rows.length === 0) { setAgg(null); return; }
      setAgg({
        total_current: rows.reduce((s, f) => s + (f.current_level ?? 0), 0),
        total_capacity: rows.reduce((s, f) => s + (f.capacity ?? 0), 0),
        criticalCount: rows.filter((f) => f.risk === "critical").length,
        warningCount: rows.filter((f) => f.risk === "warning").length,
        phcCount: rows.length,
      });
    }).catch(() => setAgg(null));
    return () => { cancelled = true; };
  }, [medicine, state]);

  if (!agg) return null;
  const pct = agg.total_capacity ? Math.round((agg.total_current / agg.total_capacity) * 100) : 0;

  return (
    <Link
      to={`/medicines/${encodeURIComponent(medicine)}/states/${encodeURIComponent(state)}`}
      className="flex items-center justify-between p-2 rounded-md hover:bg-slate-50"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{state}</div>
        <div className="text-xs text-slate-500">
          {agg.phcCount} PHCs · {agg.total_current} {unit} of {agg.total_capacity} capacity ({pct}%)
        </div>
      </div>
      <div className="flex items-center gap-2">
        {agg.criticalCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">{agg.criticalCount}</span>
        )}
        {agg.warningCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">{agg.warningCount}</span>
        )}
        <div className="text-xs text-slate-400">{pct}%</div>
      </div>
    </Link>
  );
}
