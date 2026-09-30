import { useRef, useState } from "react";
import axios from "axios";
import { Brain, Check, CheckCircle2, Lock, X } from "lucide-react";
import type { RedistributionRec, Medicine } from "../lib/types";
import { useLang } from "../lib/LangContext";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import RiskBadge from "./RiskBadge";

interface Props {
  recs: RedistributionRec[];
  medicines?: Medicine[];
  onTransferExecuted?: () => void;
}

// Stable identity for a recommendation row. The LP re-solves from scratch on
// every refetch, so array index is not a safe key: after an execute, rows
// shift and an identical-looking (or genuinely new) row can land at the same
// index — a per-row "done" flag keyed by index would then mark the wrong row.
function recKey(r: { medicine: string; from_phc_id: string; to_phc_id: string }): string {
  return `${r.medicine}|${r.from_phc_id}|${r.to_phc_id}`;
}

// How long a just-executed (medicine, from, to) pair is hidden even if the
// server's next solve proposes it again (e.g. the donor still has spare
// stock above the recipient's new reorder level). Without this, a genuinely
// fresh recommendation that happens to look identical is indistinguishable
// from "my click did nothing" — the exact glitch this component used to have.
const SUPPRESS_MS = 60_000;

interface Toast {
  id: number;
  text: string;
}

export default function RedistributionList({ recs, medicines, onTransferExecuted }: Props) {
  const { t, lang } = useLang();
  const { canAccessPhc } = useAuth();
  // Row awaiting a second click to confirm (armed by the first Execute click).
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [executingKey, setExecutingKey] = useState<string | null>(null);
  // Keys suppressed from the list after a successful execute. A row is
  // removed from this set by its own self-clearing setTimeout (below), so
  // render only ever needs to check membership — never the wall clock,
  // which would make this component impure.
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  // AI Explainability state: key = `${from}-${to}-${medicine}`
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [loadingExplain, setLoadingExplain] = useState<Record<string, boolean>>({});
  const [expandedExplain, setExpandedExplain] = useState<Record<string, boolean>>({});

  // Build a quick lookup for medicine metadata by name
  const medMap = new Map<string, Medicine>();
  (medicines || []).forEach((m) => medMap.set(m.name, m));

  const pushToast = (text: string) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts, { id, text }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5000);
  };

  const visibleRecs = recs.filter((r) => !suppressed.has(recKey(r)));

  const handleExecute = async (r: RedistributionRec) => {
    const key = recKey(r);
    setExecutingKey(key);
    setConfirmingKey(null);
    try {
      await api.executeTransfer(r.from_phc_id, r.to_phc_id, r.medicine, r.quantity);
      // Optimistic: hide this exact recommendation immediately rather than
      // waiting for the parent's refetch, and keep it hidden for a while even
      // if the next solve proposes it again — that reappearance is what read
      // as an "unlimited quantity" glitch before. The entry removes itself
      // (event-driven, not a render-time sweep) so it never lingers.
      setSuppressed((s) => new Set(s).add(key));
      setTimeout(() => setSuppressed((s) => {
        if (!s.has(key)) return s;
        const next = new Set(s);
        next.delete(key);
        return next;
      }), SUPPRESS_MS);
      pushToast(`Transferred ${r.quantity} ${r.unit} ${r.medicine}: ${r.from_phc_name} → ${r.to_phc_name}`);
      onTransferExecuted?.();
    } catch (err) {
      console.error(err);
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : null;
      alert(detail ? `Transfer failed: ${detail}` : "Redistribution transfer failed. Please try again.");
    } finally {
      setExecutingKey(null);
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

  return (
    <div className="relative">
      {/* Toasts: scoped to this panel, not a page-level overlay, so several
          panels executing transfers independently never collide. */}
      {toasts.length > 0 && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 flex flex-col items-end gap-1.5">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="animate-rise-in pointer-events-auto flex max-w-xs items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 shadow-md"
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <span>{toast.text}</span>
            </div>
          ))}
        </div>
      )}

      {visibleRecs.length === 0 ? (
        <div className="text-sm text-slate-400 py-6 text-center">
          {recs.length > 0 ? "All current recommendations were just actioned." : "No transfers recommended right now."}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {visibleRecs.map((r) => {
            const key = recKey(r);
            const explainKey = `${r.from_phc_id}-${r.to_phc_id}-${r.medicine}`;
            const hasPreloaded = !!r.explanation;
            const isExplainOpen = hasPreloaded || !!expandedExplain[explainKey];
            const isExplainLoading = !!loadingExplain[explainKey];
            const explanationText = r.explanation ?? explanations[explainKey];
            const isConfirming = confirmingKey === key;
            const isExecuting = executingKey === key;
            const anyInFlight = executingKey !== null;
            // Mirrors the backend's authorize_transfer check (services/auth.py) so
            // an out-of-jurisdiction row can't even be clicked, instead of round-
            // tripping to the server just to get a 403 back.
            const canExecute = canAccessPhc(r.from_phc_id, r.from_state);

            return (
              <div key={key} className="py-3">
                <div className="flex flex-col gap-2 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between min-[560px]:gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <div className="shrink-0">{r.quantity} {r.unit} ·</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        {medMap.has(r.medicine) ? (
                          <span
                            className="inline-flex shrink-0 items-center px-2 py-0.5 text-[11px] font-semibold rounded"
                            style={{ backgroundColor: medMap.get(r.medicine)?.tier_color || "#ddd", color: "#fff" }}
                            title={medMap.get(r.medicine)?.tier_description || ""}
                          >
                            {medMap.get(r.medicine)?.tier_badge || medMap.get(r.medicine)?.tier_title}
                          </span>
                        ) : null}
                        <span>{r.medicine}</span>
                      </div>
                    </div>
                    <div className="text-sm text-slate-500">
                      {t("from")}{" "}
                      <span className="whitespace-nowrap font-medium text-slate-700">
                        {r.from_phc_name} ({r.from_state})
                      </span>{" "}
                      → {t("to")}{" "}
                      <span className="whitespace-nowrap font-medium text-slate-700">
                        {r.to_phc_name} ({r.to_state})
                      </span>
                      {r.cross_state && <span className="ml-1 text-xs text-indigo-500 font-medium">cross-state</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 min-[560px]:shrink-0 min-[560px]:text-right">
                    <div className="text-xs text-slate-400">{r.distance_km} km</div>
                    <RiskBadge risk={r.urgency} />
                    {/* Why? button — hidden for rows with auto-expanded pre-loaded explanation */}
                    {!hasPreloaded && !isConfirming && (
                      <button
                        onClick={() => handleExplain(r)}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border font-medium transition-all cursor-pointer ${
                          isExplainOpen
                            ? "bg-violet-50 border-violet-200 text-violet-700"
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700"
                        }`}
                        title="AI-generated explanation for this recommendation"
                      >
                        <Brain size={12} /> Why?
                      </button>
                    )}

                    {!canExecute ? (
                      <span
                        title={`Outside your jurisdiction — only ${r.from_state} can execute a transfer out of ${r.from_phc_name}`}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-slate-200 bg-slate-50 text-slate-400 font-medium cursor-not-allowed"
                      >
                        <Lock size={11} /> {t("execute")}
                      </span>
                    ) : isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleExecute(r)}
                          disabled={anyInFlight}
                          autoFocus
                          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border font-semibold bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                        >
                          <Check size={12} /> Confirm
                        </button>
                        <button
                          onClick={() => setConfirmingKey(null)}
                          disabled={anyInFlight}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border font-medium bg-white border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
                        >
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingKey(key)}
                        disabled={anyInFlight}
                        className={`text-xs px-2.5 py-1 rounded-md border font-semibold transition-all cursor-pointer ${
                          isExecuting
                            ? "bg-slate-100 text-slate-400 border-slate-200"
                            : "bg-brand-50 border-brand-200 text-brand-700 hover:bg-brand-600 hover:text-white hover:border-brand-600 disabled:opacity-50"
                        }`}
                      >
                        {isExecuting ? "..." : t("execute")}
                      </button>
                    )}
                  </div>
                </div>

                {isConfirming && (
                  <div className="mt-2 ml-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Move <strong>{r.quantity} {r.unit}</strong> of <strong>{r.medicine}</strong> from{" "}
                    <strong>{r.from_phc_name}</strong> to <strong>{r.to_phc_name}</strong>? This updates live stock
                    immediately and cannot be undone from here.
                  </div>
                )}

                {/* AI Explainability accordion */}
                {isExplainOpen && !isConfirming && (
                  <div className={`mt-2 ml-1 pl-3 border-l-2 ${hasPreloaded ? "border-violet-400" : "border-violet-200"}`}>
                    {isExplainLoading ? (
                      <div className="text-xs text-slate-400 animate-pulse py-1">Generating explanation...</div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        {hasPreloaded && (
                          <span className="flex items-center gap-0.5 text-[10px] text-violet-500 font-bold mt-0.5 shrink-0">
                            <Brain size={11} /> AI
                          </span>
                        )}
                        <p className="text-xs text-slate-600 leading-relaxed">{explanationText}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
