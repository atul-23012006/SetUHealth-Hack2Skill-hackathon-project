import { useState } from "react";
import { CloudLightning, TrendingUp } from "lucide-react";
import type { Forecast } from "../lib/types";
import { useLang } from "../lib/LangContext";
import { api } from "../lib/api";
import RiskBadge from "./RiskBadge";

export default function AlertsList({ alerts }: { alerts: Forecast[] }) {
  const { t, lang } = useLang();
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const key = (a: Forecast) => `${a.phc_id}::${a.medicine}`;

  const explain = async (a: Forecast) => {
    const k = key(a);
    if (explanations[k]) {
      setExplanations((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
      return;
    }
    setLoadingKey(k);
    try {
      const explanation = await api.explainAlert(a.phc_id, a.medicine, lang);
      setExplanations((prev) => ({ ...prev, [k]: explanation }));
    } finally {
      setLoadingKey(null);
    }
  };

  if (alerts.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No active alerts.</div>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {alerts.map((a) => {
        const k = key(a);
        return (
          <div key={k} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 truncate">
                  {a.phc_name} <span className="text-slate-400 font-normal">· {a.district}, {a.state}</span>
                </div>
                <div className="text-sm text-slate-500 flex items-center gap-2 flex-wrap mt-0.5">
                  <span>
                    {a.medicine} —{" "}
                    {a.days_to_stockout === 0 ? t("outOfStock") : `${a.days_to_stockout} ${t("daysLeft")}`}
                  </span>
                  {a.weather_adjusted && (
                    <span
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-100"
                      title={`Weather scenario: expected demand ×${a.weather_factor}. Baseline ${a.baseline_days_to_stockout ?? "no stockout"} days, ${a.baseline_risk}.`}
                    >
                      <CloudLightning size={11} aria-hidden="true" /> weather ×{a.weather_factor}
                      {a.baseline_days_to_stockout != null && <span className="font-normal text-violet-500">· was {a.baseline_days_to_stockout} d</span>}
                    </span>
                  )}
                  {a.surge_detected && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-100 uppercase tracking-wide">
                      <TrendingUp size={11} /> {t("demandSurge")}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <RiskBadge risk={a.risk} />
                <button
                  onClick={() => explain(a)}
                  className="text-xs px-2 py-1 rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                >
                  {loadingKey === k ? "…" : t("explain")}
                </button>
              </div>
            </div>
            {explanations[k] && (
              <div className="mt-2 text-sm bg-brand-50 border border-brand-100 text-brand-900 rounded-md p-2">
                {explanations[k]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
