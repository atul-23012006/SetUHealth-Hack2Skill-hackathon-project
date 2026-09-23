import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDown, LifeBuoy, Lock, ShieldCheck, ShieldOff, Truck, Users, type LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { useLang } from "../lib/LangContext";
import { useCountUp } from "../lib/useCountUp";
import { STATE_CENTROIDS } from "../lib/stateCentroids";
import IndiaMap, { type StateRiskMarker } from "../components/IndiaMap";
import HeroOrbLazy from "../components/HeroOrbLazy";
import type { PublicNationalSummary, PublicStateSummary } from "../lib/types";

function PublicStat({ label, value, thousands }: { label: string; value: string | number; thousands?: boolean }) {
  const animated = useCountUp(value, 1600, thousands);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand-400/40 hover:bg-white/10">
      <div className="text-3xl font-bold tabular-nums text-white">{animated}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-brand-200">{label}</div>
    </div>
  );
}

function ImpactCard({ title, body, icon: Icon, tone }: { title: string; body: string; icon: LucideIcon; tone: string }) {
  return (
    <div className="card card-lift group p-5">
      <div className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${tone} transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3`}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{title}</div>
      <p className="text-sm leading-relaxed text-slate-700">{body}</p>
    </div>
  );
}

function TrustBadge({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur">
      {icon}
      {children}
    </span>
  );
}

export default function PublicPortal() {
  const { t } = useLang();
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
    return <PageLoader label={t("pub.loading")} />;
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
  // Per-capita, not per-facility: ranks by critical-risk facilities per
  // 100,000 people served, which can (and does) order states differently
  // than avg_risk_score above — a state with fewer, larger-catchment PHCs
  // can carry more real per-capita exposure than one with more small PHCs.
  const withPopulation = states.filter((s) => s.population_served > 0);
  const highestPerCapita = [...withPopulation].sort((a, b) => b.critical_risk_per_100k - a.critical_risk_per_100k)[0];

  return (
    <div className="space-y-10">
      <section
        id="public-hero"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-950 via-slate-900 to-slate-950 text-white shadow-2xl"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-96 w-96 animate-blob rounded-full bg-brand-500/25 blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-[26rem] w-[26rem] animate-blob-slow rounded-full bg-gold-400/15 blur-3xl" />
          <div className="bg-grid absolute inset-0" />
        </div>

        <div className="relative grid items-center gap-4 p-6 sm:p-10 md:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-brand-200 backdrop-blur">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {t("pub.eyebrow")}
            </div>
            <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight sm:text-5xl">
              {t("pub.title.a")}<span className="text-gradient">{t("pub.title.b")}</span>
            </h1>
            <p className="mt-4 max-w-xl leading-relaxed text-slate-300">
              {t("pub.lead")}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => document.getElementById("public-map")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gold-400 to-gold-500 px-5 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-gold-500/30 hover:-translate-y-0.5 hover:from-gold-300 hover:to-gold-400"
              >
                {t("pub.cta.map")} <ArrowDown size={15} aria-hidden="true" />
              </button>
              <Link
                to="/"
                className="rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                {t("pub.cta.console")}
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <TrustBadge icon={<Lock size={12} aria-hidden="true" />}>{t("pub.badge.aggregates")}</TrustBadge>
              <TrustBadge icon={<ShieldOff size={12} aria-hidden="true" />}>{t("pub.badge.noFacility")}</TrustBadge>
              <TrustBadge icon={<ShieldCheck size={12} aria-hidden="true" />}>{t("pub.badge.noPatient")}</TrustBadge>
            </div>
          </div>

          <div id="public-orb" className="relative mx-auto h-[280px] w-[280px] sm:h-[380px] sm:w-[380px] md:h-[470px] md:w-[470px]">
            <HeroOrbLazy />
            <div className="animate-float absolute left-0 top-10 hidden rounded-xl border border-white/15 bg-slate-900/60 px-3 py-2 text-xs backdrop-blur md:block">
              <div className="text-lg font-bold leading-none text-gold-300">{national.states_covered}</div>
              <div className="mt-0.5 text-slate-300">{t("pub.chip.states")}</div>
            </div>
            <div className="animate-float-slow absolute bottom-12 right-0 hidden rounded-xl border border-white/15 bg-slate-900/60 px-3 py-2 text-xs backdrop-blur md:block">
              <div className="text-lg font-bold leading-none text-brand-300">{national.total_facilities_monitored}</div>
              <div className="mt-0.5 text-slate-300">{t("pub.chip.facilities")}</div>
            </div>
          </div>
        </div>

        <div
          id="public-stats"
          className="stagger relative grid grid-cols-2 gap-4 border-t border-white/10 bg-white/[0.03] p-5 md:grid-cols-5"
        >
          {/* "Facilities", not "PHCs": the network now also covers blood banks
              and district hospitals (see app/data/resource_types.py). */}
          <PublicStat label={t("pub.stat.facilities")} value={national.total_facilities_monitored} />
          <PublicStat label={t("pub.stat.population")} value={national.population_served} thousands />
          <PublicStat label={t("pub.stat.states")} value={national.states_covered} />
          <PublicStat label={t("pub.stat.transfers")} value={national.transfers_executed_30d} />
          <PublicStat label={t("pub.stat.averted")} value={national.stockouts_prevented_30d} />
        </div>
      </section>

      <section id="public-map">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">{t("pub.map.title")}</h2>
          <span className="text-xs text-slate-400">{t("pub.map.hint")}</span>
        </div>
        <div className="card p-2 h-[440px]">
          <IndiaMap
            readOnly
            stateMarkers={stateMarkers}
            onStateClick={(state) => navigate(`/public/states/${encodeURIComponent(state)}`)}
          />
        </div>
      </section>

      <section id="public-insights" className="stagger grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {lowestRisk && (
          <ImpactCard
            icon={ShieldCheck}
            tone="bg-emerald-50 text-emerald-600"
            title={t("pub.insight.lowest")}
            body={t("pub.insight.lowest.body", { state: lowestRisk.state, score: lowestRisk.avg_risk_score, n: lowestRisk.facility_count })}
          />
        )}
        {highestRisk && (
          <ImpactCard
            icon={LifeBuoy}
            tone="bg-rose-50 text-rose-600"
            title={t("pub.insight.highest")}
            body={t("pub.insight.highest.body", { state: highestRisk.state, c: highestRisk.critical_facility_count, n: highestRisk.facility_count })}
          />
        )}
        {highestPerCapita && (
          <ImpactCard
            icon={Users}
            tone="bg-amber-50 text-amber-600"
            title={t("pub.insight.percapita")}
            body={t("pub.insight.percapita.body", { state: highestPerCapita.state, v: highestPerCapita.critical_risk_per_100k })}
          />
        )}
        {mostTransfers && mostTransfers.transfers_executed_30d > 0 ? (
          <ImpactCard
            icon={Truck}
            tone="bg-brand-50 text-brand-600"
            title={t("pub.insight.active")}
            body={t(mostTransfers.transfers_executed_30d === 1 ? "pub.insight.active.one" : "pub.insight.active.many", {
              state: mostTransfers.state,
              n: mostTransfers.transfers_executed_30d,
            })}
          />
        ) : (
          <ImpactCard
            icon={Truck}
            tone="bg-brand-50 text-brand-600"
            title={t("pub.insight.network")}
            body={t("pub.insight.network.body", { n: national.transfers_executed_30d })}
          />
        )}
      </section>
    </div>
  );
}
