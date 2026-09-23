import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { AlertTriangle, ArrowRightLeft, Building2, Gauge, ShieldCheck, Users, UsersRound } from "lucide-react";
import StatCard from "../components/StatCard";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import type { PublicStateSummary } from "../lib/types";

// Deliberately does not reuse pages/StateView.tsx: that page lists individual
// PHCs by name with links into /phcs/:id, which would leak facility-level
// detail onto a public, no-login surface. This page only ever renders the
// same state-level aggregate /api/public/states already returns.
export default function PublicStateDetail() {
  const { state } = useParams<{ state: string }>();
  const { t } = useLang();
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

  if (loading) return <PageLoader label={t("pubState.loading")} />;

  if (!summary) {
    return (
      <div className="text-center text-slate-400 py-20 space-y-2">
        <p>{t("pubState.noData")}</p>
        <Link to="/public" className="text-brand-600 hover:underline text-sm">
          {t("pubState.backNoData")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/public" className="text-sm text-brand-600 hover:underline">
        {t("pubState.back")}
      </Link>
      <div id="pub-state-header">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold text-ink-900 tracking-tight">
          {summary.state}
        </h1>
        <p className="text-sm text-ink-600 mt-1">{t("pubState.note")}</p>
      </div>
      <div id="pub-state-stats" className="stagger grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label={t("pub.stat.facilities")} value={summary.facility_count} icon={Building2} />
        <StatCard label={t("pub.stat.population")} value={summary.population_served} thousands icon={Users} />
        <StatCard
          label={t("pub.stat.riskScore")}
          icon={Gauge}
          value={summary.avg_risk_score}
          tone={summary.avg_risk_score >= 60 ? "critical" : summary.avg_risk_score >= 25 ? "warning" : "good"}
        />
        <StatCard label={t("pub.stat.critical")} value={summary.critical_facility_count} tone="critical" icon={AlertTriangle} pulse={summary.critical_facility_count > 0} />
        <StatCard
          label={t("pub.stat.per100k")}
          icon={UsersRound}
          value={summary.critical_risk_per_100k}
          tone={summary.critical_risk_per_100k >= 2 ? "critical" : summary.critical_risk_per_100k >= 1 ? "warning" : "good"}
        />
        <StatCard label={t("pub.stat.transfers")} value={summary.transfers_executed_30d} icon={ArrowRightLeft} />
        <StatCard label={t("pub.stat.averted")} value={summary.stockouts_prevented_30d} tone="good" icon={ShieldCheck} />
      </div>
      <div className="text-xs text-slate-400">{t("pubState.updated", { time: new Date(summary.last_updated).toLocaleString() })}</div>
    </div>
  );
}
