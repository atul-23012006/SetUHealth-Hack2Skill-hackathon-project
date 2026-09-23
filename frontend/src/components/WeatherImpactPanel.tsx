import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronDown, CloudLightning, Info, Snowflake } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";
import RiskBadge from "./RiskBadge";

interface Props {
  /** Re-plan the Dashboard's alerts and recommendations against this scenario. */
  applied: boolean;
  onApply: (on: boolean) => void;
  intensity: number;
  onIntensity: (v: number) => void;
}

// A scenario, not a measurement: real weather forecasts turned into demand by a
// short table of stated planning assumptions. The switch only changes what the
// Dashboard *shows*; stored data and the baseline forecast never change.
export default function WeatherImpactPanel({ applied, onApply, intensity, onIntensity }: Props) {
  const { t: tr } = useLang();
  const fmtDays = (d: number | null) => (d === null ? tr("impact.noStockout") : d === 0 ? tr("impact.outNow") : tr("impact.days", { n: d }));
  // The slider moves freely; the (slower) request follows once it settles.
  const [committed, setCommitted] = useState(intensity);
  useEffect(() => {
    const id = setTimeout(() => setCommitted(intensity), 350);
    return () => clearTimeout(id);
  }, [intensity]);

  const { data, error, loading, reload } = useAsync(() => api.liveImpact(committed), [committed]);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const t = data?.totals;

  return (
    <section id="weather-impact" className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CloudLightning size={16} aria-hidden="true" className="text-violet-600" /> {tr("impact.title")}
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
              {tr("impact.badge")}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {tr("impact.desc")}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
          <input
            type="checkbox"
            role="switch"
            checked={applied}
            onChange={(e) => onApply(e.target.checked)}
            className="h-4 w-4 accent-violet-600"
          />
          {tr("impact.apply")}
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
        <label className="flex items-center gap-2">
          {tr("impact.strength")}
          <input
            type="range" min={0.25} max={2} step={0.25} value={intensity}
            onChange={(e) => onIntensity(Number(e.target.value))}
            aria-label={tr("impact.strength")}
            className="w-40 accent-violet-600"
          />
          <span className="w-10 font-semibold tabular-nums text-slate-800">×{intensity.toFixed(2)}</span>
        </label>
        <span className="text-slate-400">{tr("impact.strengthHint")}</span>
      </div>

      {loading && !data && <div className="skeleton mt-4 h-40" />}
      {error && !data && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={15} aria-hidden="true" /> {tr("impact.unavailable", { err: error })}
          <button onClick={reload} className="ml-auto rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold hover:bg-amber-100">{tr("common.tryAgain")}</button>
        </div>
      )}

      {data && t && (
        <div className={`mt-4 space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: tr("impact.stat.exposed"), value: t.pairs_affected, tone: "text-slate-900" },
              { label: tr("impact.stat.worse"), value: t.pairs_worsened, tone: t.pairs_worsened ? "text-amber-600" : "text-slate-900" },
              { label: tr("impact.stat.critical"), value: t.new_critical, tone: t.new_critical ? "text-rose-600" : "text-slate-900" },
              { label: tr("impact.stat.cold"), value: t.cold_chain_items_exposed_to_heat, tone: t.cold_chain_items_exposed_to_heat ? "text-sky-700" : "text-slate-900" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-slate-50 p-3">
                <div className={`text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          {data.items.length === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {tr("impact.none")}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{tr("impact.col.facility")}</th>
                    <th className="px-3 py-2 text-left">{tr("impact.col.medicine")}</th>
                    <th className="px-3 py-2 text-left">{tr("impact.col.driver")}</th>
                    <th className="px-3 py-2 text-left">{tr("impact.col.days")}</th>
                    <th className="px-3 py-2 text-left">{tr("impact.col.risk")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.slice(0, 8).map((i) => (
                    <tr key={`${i.phc_id}:${i.medicine}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <Link to={`/phcs/${i.phc_id}`} className="font-medium text-brand-700 hover:underline">{i.phc_name}</Link>
                        <div className="text-[11px] text-slate-400">{i.district}, {i.state}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{i.medicine}<div className="text-[11px] text-slate-400">{tr("impact.demand", { n: i.factor })}</div></td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {i.causes.map((c) => (
                            <span key={c.signal} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{tr(`signal.${c.signal}`)}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">
                        {fmtDays(i.days_before)} <ArrowRight size={11} className="mx-0.5 inline text-slate-400" aria-hidden="true" />
                        <strong className="text-slate-900">{fmtDays(i.days_after)}</strong>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1"><RiskBadge risk={i.risk_before} /><ArrowRight size={11} className="text-slate-400" aria-hidden="true" /><RiskBadge risk={i.risk_after} /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.items.length > 8 && <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">{tr("impact.showing", { n: t.pairs_worsened })}</div>}
            </div>
          )}

          {t.cold_chain_items_exposed_to_heat > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
              <Snowflake size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {tr("impact.coldNote", { n: t.cold_chain_items_exposed_to_heat })}
            </div>
          )}

          <div>
            <button onClick={() => setShowAssumptions((s) => !s)} aria-expanded={showAssumptions} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <Info size={13} aria-hidden="true" /> {tr("impact.assumptions")}
              <ChevronDown size={13} className={`transition-transform ${showAssumptions ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {showAssumptions && (
              <div className="animate-fade-in mt-2 overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-3 py-2 text-left">{tr("impact.tbl.signal")}</th><th className="px-3 py-2 text-left">{tr("impact.tbl.medicine")}</th><th className="px-3 py-2 text-left">{tr("impact.tbl.elevated")}</th><th className="px-3 py-2 text-left">{tr("impact.tbl.high")}</th><th className="px-3 py-2 text-left">{tr("impact.tbl.reasoning")}</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.assumptions.map((a) => (
                      <tr key={`${a.signal}:${a.medicine}`}>
                        <td className="px-3 py-1.5 text-slate-700">{tr(`signal.${a.signal}`)}</td>
                        <td className="px-3 py-1.5 text-slate-700">{a.medicine}</td>
                        <td className="px-3 py-1.5 tabular-nums">×{a.elevated}</td>
                        <td className="px-3 py-1.5 tabular-nums">×{a.high}</td>
                        <td className="px-3 py-1.5 text-slate-500">{a.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  {data.disclaimer} {tr("impact.noCompound")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
