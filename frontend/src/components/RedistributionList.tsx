import type { RedistributionRec } from "../lib/types";
import { useLang } from "../lib/LangContext";
import RiskBadge from "./RiskBadge";

export default function RedistributionList({ recs }: { recs: RedistributionRec[] }) {
  const { t } = useLang();

  if (recs.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No transfers recommended right now.</div>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {recs.map((r, i) => (
        <div key={i} className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-slate-900">
              {r.quantity} {r.unit} · {r.medicine}
            </div>
            <div className="text-sm text-slate-500 truncate">
              {t("from")} <span className="font-medium text-slate-700">{r.from_phc_name}</span> ({r.from_state}) →{" "}
              {t("to")} <span className="font-medium text-slate-700">{r.to_phc_name}</span> ({r.to_state})
              {r.cross_state && <span className="ml-1 text-xs text-indigo-500 font-medium">cross-state</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 text-right">
            <div className="text-xs text-slate-400">{r.distance_km} km</div>
            <RiskBadge risk={r.urgency} />
          </div>
        </div>
      ))}
    </div>
  );
}
