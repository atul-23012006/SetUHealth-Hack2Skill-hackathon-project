import { useState } from "react";
import { AlertTriangle, Building2, ChevronDown, ExternalLink, Info, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";

const DEMO_STATES = ["Maharashtra", "Uttar Pradesh", "Bihar", "Rajasthan", "Tamil Nadu", "Kerala"];

// Official (but historical) government facility counts, next to how many
// facilities this demo network models for the same state. The network is a
// deliberately scaled-down synthetic dataset (see README), so a low
// network-vs-official percentage is expected and not a data quality problem —
// the point is to make the scale-down visible, not to imply either number is
// "the" current count.
export default function FacilityCountBenchmark() {
  const { t } = useLang();
  const { data, error, loading, reload } = useAsync(() => api.liveFacilityCountBenchmarks(DEMO_STATES), []);
  const [showNote, setShowNote] = useState(false);

  return (
    <div id="fed-facility-counts" className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Building2 size={16} className="text-brand-600" aria-hidden="true" /> {t("facilityBench.title")}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("common.realData")}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">{t("facilityBench.desc")}</p>
        </div>
        {data && (
          <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand-700">
            data.gov.in <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>

      {loading && !data && <div className="skeleton mt-4 h-56" />}
      {error && !data && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} aria-hidden="true" /> {t("facilityBench.unavailable", { err: error })}
          <button onClick={reload} className="ml-auto rounded-md border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100">
            {t("common.retry")}
          </button>
        </div>
      )}

      {data && (
        <div className={`mt-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">{t("facilityBench.col.state")}</th>
                  <th className="px-3 py-2 text-right">{t("facilityBench.col.officialPhcs")}</th>
                  <th className="px-3 py-2 text-right">{t("facilityBench.col.officialSub")}</th>
                  <th className="px-3 py-2 text-right">{t("facilityBench.col.officialChc")}</th>
                  <th className="px-3 py-2 text-right">{t("facilityBench.col.network")}</th>
                  <th className="px-3 py-2 text-right">{t("facilityBench.col.pct")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.states.map((row) => (
                  <tr key={row.state} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-800">{row.state}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.official.phcs?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{row.official.sub_centres?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{row.official.chcs?.toLocaleString() ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{row.network_facility_count ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {row.network_vs_official_phcs_pct !== null ? `${row.network_vs_official_phcs_pct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("facilityBench.asOf", { date: data.as_of })}
          </div>

          <div className="mt-2">
            <button onClick={() => setShowNote((s) => !s)} aria-expanded={showNote} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
              {t("facilityBench.whyDifferent")}
              <ChevronDown size={13} className={`transition-transform ${showNote ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            {showNote && (
              <p className="animate-fade-in mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
                {data.disclaimer}
              </p>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>{data.source}{data.stale ? ` · ${t("live.stale")}` : ""}</span>
            <button onClick={reload} className="inline-flex items-center gap-1 hover:text-slate-600">
              <RefreshCw size={10} aria-hidden="true" /> {t("common.refresh")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
