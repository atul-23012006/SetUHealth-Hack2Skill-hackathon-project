import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useCountUp } from "../lib/useCountUp";
import { STATE_CENTROIDS } from "../lib/stateCentroids";
import IndiaMap, { type StateRiskMarker } from "../components/IndiaMap";
import type { PublicNationalSummary, PublicStateSummary } from "../lib/types";

function PublicStat({ label, value }: { label: string; value: string | number }) {
  const animated = useCountUp(value, 1400);
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 backdrop-blur-sm">
      <div className="text-3xl font-bold text-white tabular-nums">{animated}</div>
      <div className="text-xs text-teal-200 uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

function ImpactCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="text-xs font-semibold text-teal-700 uppercase tracking-wide mb-2">{title}</div>
      <p className="text-sm text-slate-700 leading-relaxed">{body}</p>
    </div>
  );
}

export default function PublicPortal() {
  const navigate = useNavigate();
  const [national, setNational] = useState<PublicNationalSummary | null>(null);
  const [states, setStates] = useState<PublicStateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.publicNational(), api.publicStates()]).then(([n, s]) => {
      setNational(n);
      setStates(s);
      setLoading(false);
    });
  }, []);

  if (loading || !national) {
    return <div className="text-center text-slate-400 py-20">Loading public network overview…</div>;
  }

  const stateMarkers: StateRiskMarker[] = states
    .filter((s) => STATE_CENTROIDS[s.state])
    .map((s) => ({
      state: s.state,
      lat: STATE_CENTROIDS[s.state][0],
      lon: STATE_CENTROIDS[s.state][1],
      riskScore: s.avg_risk_score,
      facilityCount: s.facility_count,
    }));

  const withFacilities = states.filter((s) => s.facility_count > 0);
  const lowestRisk = [...withFacilities].sort((a, b) => a.avg_risk_score - b.avg_risk_score)[0];
  const highestRisk = [...withFacilities].sort((a, b) => b.avg_risk_score - a.avg_risk_score)[0];
  const mostTransfers = [...states].sort((a, b) => b.transfers_executed_30d - a.transfers_executed_30d)[0];

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-3xl font-bold text-slate-900">National Supply Network — Live Overview</h1>
        <p className="text-slate-500 mt-1 max-w-2xl">
          Every figure below is a state or national aggregate, computed the same way SetuHealth's
          federated layer computes them internally — no facility name, location, or
          patient-adjacent data ever appears on this page.
        </p>
      </section>

      <section className="bg-gradient-to-r from-teal-950 via-slate-900 to-slate-950 rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* "Facilities", not "PHCs": the network now also covers blood banks
            and district hospitals (see app/data/resource_types.py). */}
        <PublicStat label="Facilities monitored" value={national.total_facilities_monitored} />
        <PublicStat label="States covered" value={national.states_covered} />
        <PublicStat label="Transfers executed (30d)" value={national.transfers_executed_30d} />
        <PublicStat label="Stockouts averted (30d)" value={national.stockouts_prevented_30d} />
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Network risk by state</h2>
          <span className="text-xs text-slate-400">Click a state for its aggregate detail</span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2 h-[440px]">
          <IndiaMap
            readOnly
            stateMarkers={stateMarkers}
            onStateClick={(state) => navigate(`/public/states/${encodeURIComponent(state)}`)}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {lowestRisk && (
          <ImpactCard
            title="Lowest network risk"
            body={`${lowestRisk.state} currently has the network's lowest aggregate risk score (${lowestRisk.avg_risk_score}/100) across ${lowestRisk.facility_count} monitored facilities.`}
          />
        )}
        {highestRisk && (
          <ImpactCard
            title="Needs the most support"
            body={`${highestRisk.state} has ${highestRisk.critical_facility_count} of ${highestRisk.facility_count} facilities at critical stock risk right now — the highest concentration nationwide.`}
          />
        )}
        {mostTransfers && mostTransfers.transfers_executed_30d > 0 ? (
          <ImpactCard
            title="Most active redistribution"
            body={`${mostTransfers.state} received ${mostTransfers.transfers_executed_30d} redistribution transfer${
              mostTransfers.transfers_executed_30d === 1 ? "" : "s"
            } in the last 30 days, each one averting a stockout before it happened.`}
          />
        ) : (
          <ImpactCard
            title="Redistribution network"
            body={`${national.transfers_executed_30d} redistribution transfers completed nationwide in the last 30 days, moving supply to facilities before they ran out.`}
          />
        )}
      </section>
    </div>
  );
}
