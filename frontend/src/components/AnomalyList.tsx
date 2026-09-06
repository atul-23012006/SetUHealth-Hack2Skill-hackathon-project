import { useState } from "react";
import { Link } from "react-router-dom";
import type { ConsumptionAnomaly } from "../lib/types";
import { useLang } from "../lib/LangContext";
import { api } from "../lib/api";

export default function AnomalyList({ anomalies }: { anomalies: ConsumptionAnomaly[] }) {
  const { t, lang } = useLang();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  if (anomalies.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">{t("noAnomalies")}</div>;
  }

  const investigate = async (a: ConsumptionAnomaly) => {
    if (notes[a.phc_id]) {
      setNotes((s) => {
        const next = { ...s };
        delete next[a.phc_id];
        return next;
      });
      return;
    }
    setLoadingKey(a.phc_id);
    try {
      const res = await api.explainAnomaly(a.phc_id, lang);
      setNotes((s) => ({ ...s, [a.phc_id]: res.explanation || "No explanation available." }));
    } catch {
      setNotes((s) => ({ ...s, [a.phc_id]: "Unable to generate an investigator note right now." }));
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div className="divide-y divide-slate-100">
      {anomalies.map((a) => {
        const over = a.direction === "over_consumption";
        return (
          <div key={a.phc_id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wide ${
                      over
                        ? "bg-rose-100 text-rose-700 border border-rose-200"
                        : "bg-amber-100 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {over ? t("overConsumption") : t("underReporting")}
                  </span>
                  {a.severity === "high" && (
                    <span className="text-[10px] font-bold text-rose-600 uppercase">● high</span>
                  )}
                  <Link to={`/phcs/${a.phc_id}`} className="hover:underline truncate">
                    {a.phc_name}
                  </Link>
                  <span className="text-slate-400 font-normal text-xs">
                    · {a.district}, {a.state}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5 leading-snug">{a.headline}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-400">
                  <span>
                    dispensing <b className={over ? "text-rose-600" : "text-amber-600"}>{a.consumption_change_pct > 0 ? "+" : ""}{a.consumption_change_pct}%</b>
                  </span>
                  <span>
                    footfall <b className="text-slate-600">{a.footfall_change_pct > 0 ? "+" : ""}{a.footfall_change_pct}%</b>
                  </span>
                  <span>~{a.avg_daily_visits} visits/day (base {a.baseline_daily_visits})</span>
                  <span>z={a.z_score}</span>
                </div>
                {a.flagged_medicines.length > 0 && (
                  <div className="mt-1 text-[11px] text-slate-500">
                    Affected: {a.flagged_medicines.join(", ")}
                  </div>
                )}
              </div>
              <button
                onClick={() => investigate(a)}
                className="shrink-0 text-xs px-2 py-1 rounded-md border font-medium transition-all cursor-pointer bg-slate-50 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700"
              >
                {loadingKey === a.phc_id ? "…" : `🔍 ${t("investigate")}`}
              </button>
            </div>
            {notes[a.phc_id] && (
              <div className="mt-2 ml-1 pl-3 border-l-2 border-violet-200">
                <p className="text-xs text-slate-600 leading-relaxed">
                  <span className="text-[10px] text-violet-500 font-bold mr-1">🧠 AI</span>
                  {notes[a.phc_id]}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
