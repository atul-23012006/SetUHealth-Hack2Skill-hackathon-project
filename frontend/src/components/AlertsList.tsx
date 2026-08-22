import { useState } from "react";
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
                <div className="text-sm text-slate-500">
                  {a.medicine} —{" "}
                  {a.days_to_stockout === 0 ? t("outOfStock") : `${a.days_to_stockout} ${t("daysLeft")}`}
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
              <div className="mt-2 text-sm bg-teal-50 border border-teal-100 text-teal-900 rounded-md p-2">
                {explanations[k]}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
