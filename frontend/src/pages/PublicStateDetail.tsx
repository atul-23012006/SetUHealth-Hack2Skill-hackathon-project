import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import StatCard from "../components/StatCard";
import type { PublicStateSummary } from "../lib/types";

// Deliberately does not reuse pages/StateView.tsx: that page lists individual
// PHCs by name with links into /phcs/:id, which would leak facility-level
// detail onto a public, no-login surface. This page only ever renders the
// same state-level aggregate /api/public/states already returns.
export default function PublicStateDetail() {
  const { state } = useParams<{ state: string }>();
  const [summary, setSummary] = useState<PublicStateSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!state) return;
    setLoading(true);
    api.publicStates().then((all) => {
      setSummary(all.find((s) => s.state === state) ?? null);
      setLoading(false);
    });
  }, [state]);

  if (loading) return <div className="text-center text-slate-400 py-20">Loading…</div>;

  if (!summary) {
    return (
      <div className="text-center text-slate-400 py-20 space-y-2">
        <p>No public data available for this state.</p>
        <Link to="/public" className="text-teal-600 hover:underline text-sm">
          ← Back to the network overview
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/public" className="text-sm text-teal-600 hover:underline">
        ← Public network overview
      </Link>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{summary.state}</h1>
        <p className="text-sm text-slate-500 mt-1">Aggregate view only — this page never lists individual facilities.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Facilities monitored" value={summary.facility_count} />
        <StatCard
          label="Network risk score"
          value={summary.avg_risk_score}
          tone={summary.avg_risk_score >= 60 ? "critical" : summary.avg_risk_score >= 25 ? "warning" : "good"}
        />
        <StatCard label="Critical-risk facilities" value={summary.critical_facility_count} tone="critical" />
        <StatCard label="Transfers executed (30d)" value={summary.transfers_executed_30d} />
        <StatCard label="Stockouts averted (30d)" value={summary.stockouts_prevented_30d} tone="good" />
      </div>
      <div className="text-xs text-slate-400">Last updated {new Date(summary.last_updated).toLocaleString()}</div>
    </div>
  );
}
