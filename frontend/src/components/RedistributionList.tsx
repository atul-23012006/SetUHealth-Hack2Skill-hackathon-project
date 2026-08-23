import { useState } from "react";
import type { RedistributionRec, Medicine } from "../lib/types";
import { useLang } from "../lib/LangContext";
import { api } from "../lib/api";
import RiskBadge from "./RiskBadge";

interface Props {
  recs: RedistributionRec[];
  medicines?: Medicine[];
  onTransferExecuted?: () => void;
}

export default function RedistributionList({ recs, medicines, onTransferExecuted }: Props) {
  const { t } = useLang();
  const [executingIndex, setExecutingIndex] = useState<number | null>(null);

  // Build a quick lookup for medicine metadata by name
  const medMap = new Map<string, Medicine>();
  (medicines || []).forEach((m) => medMap.set(m.name, m));

  const handleExecute = async (r: RedistributionRec, index: number) => {
    setExecutingIndex(index);
    try {
      await api.executeTransfer(r.from_phc_id, r.to_phc_id, r.medicine, r.quantity);
      if (onTransferExecuted) {
        onTransferExecuted();
      }
    } catch (err) {
      console.error(err);
      alert("Redistribution transfer failed. Please try again.");
    } finally {
      setExecutingIndex(null);
    }
  };

  if (recs.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No transfers recommended right now.</div>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {recs.map((r, i) => (
        <div key={i} className="py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-slate-900 flex items-center gap-2">
              <div>{r.quantity} {r.unit} ·</div>
              <div className="flex items-center gap-2 truncate">
                {/* Tier badge from medicine metadata if available */}
                {medMap.has(r.medicine) ? (
                  <span
                    className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded"
                    style={{ backgroundColor: medMap.get(r.medicine)?.tier_color || "#ddd", color: "#fff" }}
                    title={medMap.get(r.medicine)?.tier_description || ""}
                  >
                    {medMap.get(r.medicine)?.tier_badge || medMap.get(r.medicine)?.tier_title}
                  </span>
                ) : null}
                <span className="truncate">{r.medicine}</span>
              </div>
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
            <button
              onClick={() => handleExecute(r, i)}
              disabled={executingIndex !== null}
              className={`text-xs px-2.5 py-1 rounded-md border font-semibold transition-all cursor-pointer ${
                executingIndex === i
                  ? "bg-slate-100 text-slate-400 border-slate-200"
                  : "bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-600 hover:text-white hover:border-teal-600"
              }`}
            >
              {executingIndex === i ? "..." : t("execute")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
