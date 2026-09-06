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
  const { t, lang } = useLang();
  const [executingIndex, setExecutingIndex] = useState<number | null>(null);

  // AI Explainability state: key = `${from}-${to}-${medicine}`
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExplain, setLoadingExplain] = useState<Record<string, boolean>>({});
  const [expandedExplain, setExpandedExplain] = useState<Record<string, boolean>>({});

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

  const handleExplain = async (r: RedistributionRec) => {
    const key = `${r.from_phc_id}-${r.to_phc_id}-${r.medicine}`;

    // Toggle off if already expanded
    if (expandedExplain[key]) {
      setExpandedExplain((s) => ({ ...s, [key]: false }));
      return;
    }

    setExpandedExplain((s) => ({ ...s, [key]: true }));

    // If the rec already has a pre-loaded explanation from the server, use it directly
    if (r.explanation) {
      setExplanations((s) => ({ ...s, [key]: r.explanation! }));
      return;
    }

    // Otherwise fetch on demand
    if (!explanations[key]) {
      setLoadingExplain((s) => ({ ...s, [key]: true }));
      try {
        const text = await api.explainTransfer(r.from_phc_id, r.to_phc_id, r.medicine, lang);
        setExplanations((s) => ({ ...s, [key]: text }));
      } catch (err) {
        console.error(err);
        setExplanations((s) => ({
          ...s,
          [key]: "Unable to generate explanation. Please check your network connection.",
        }));
      } finally {
        setLoadingExplain((s) => ({ ...s, [key]: false }));
      }
    }
  };

  if (recs.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">No transfers recommended right now.</div>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {recs.map((r, i) => {
        const key = `${r.from_phc_id}-${r.to_phc_id}-${r.medicine}`;
        // A pre-loaded server explanation auto-expands the row
        const hasPreloaded = !!r.explanation;
        const isExplainOpen = hasPreloaded || !!expandedExplain[key];
        const isExplainLoading = !!loadingExplain[key];
        const explanationText = r.explanation ?? explanations[key];

        return (
          <div key={i} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 flex items-center gap-2">
                  <div>{r.quantity} {r.unit} ·</div>
                  <div className="flex items-center gap-2 truncate">
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
                {/* Why? button — hidden for rows with auto-expanded pre-loaded explanation */}
                {!hasPreloaded && (
                  <button
                    onClick={() => handleExplain(r)}
                    className={`text-xs px-2 py-1 rounded-md border font-medium transition-all cursor-pointer ${
                      isExplainOpen
                        ? "bg-violet-50 border-violet-200 text-violet-700"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700"
                    }`}
                    title="AI-generated explanation for this recommendation"
                  >
                    🧠 Why?
                  </button>
                )}
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

            {/* AI Explainability accordion */}
            {isExplainOpen && (
              <div className={`mt-2 ml-1 pl-3 border-l-2 ${hasPreloaded ? "border-violet-400" : "border-violet-200"}`}>
                {isExplainLoading ? (
                  <div className="text-xs text-slate-400 animate-pulse py-1">Generating explanation...</div>
                ) : (
                  <div className="flex items-start gap-1.5">
                    {hasPreloaded && <span className="text-[10px] text-violet-500 font-bold mt-0.5 shrink-0">🧠 AI</span>}
                    <p className="text-xs text-slate-600 leading-relaxed">{explanationText}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
