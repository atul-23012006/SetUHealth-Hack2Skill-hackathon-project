import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  Building2, ClipboardList, User, Package, BarChart3, AlertTriangle, Hash, Bot,
  Lock, FlaskConical, Ban, ShieldCheck, TrendingUp, CheckCircle2, Check, HeartPulse,
} from "lucide-react";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { NationalFederatedPrior, BricsSharedPrior } from "../lib/types";

const RAW_DATA_BLOCKED = [
  { label: "Patient records", icon: HeartPulse },
  { label: "PHC facility IDs", icon: Building2 },
  { label: "Individual diagnoses", icon: ClipboardList },
  { label: "Staff personal data", icon: User },
  { label: "Raw stock ledgers", icon: Package },
];

const AGGREGATED_SHARED = [
  { label: "Category depletion rate (avg)", icon: BarChart3 },
  { label: "Critical alert count", icon: AlertTriangle },
  { label: "Facility count (count only)", icon: Hash },
  { label: "Model gradient weights", icon: Bot },
  { label: "Encrypted aggregated stats", icon: Lock },
];

// India is real seeded/generated PHC data. The BRICS partner nations are not
// — there is no live onboarding to Brazil/South Africa/Indonesia/Egypt health
// systems, so their summaries are deterministically-seeded synthetic stand-ins
// for what a real partner node's federated summary would look like. This
// badge exists so the demo never reads as claiming live international data.
function SimulatedDataBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-amber-400/15 border-amber-400/40 text-amber-300 ${className}`}
      title="Synthetic seeded data — not a live connection to this nation's health system"
    >
      <FlaskConical size={10} /> Simulated
    </span>
  );
}

function ConfidenceMeter({
  label,
  nodeCount,
  score,
  barColor,
}: {
  label: string;
  nodeCount: number;
  score: number;
  barColor: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">
          {nodeCount} node{nodeCount === 1 ? "" : "s"} · <span className="font-bold text-white">{score}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-700/60 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-700`}
          style={{ width: `${Math.max(2, score)}%` }}
        />
      </div>
    </div>
  );
}

export default function Federated() {
  const { t } = useLang();
  const [national, setNational] = useState<NationalFederatedPrior | null>(null);
  const [brics, setBrics] = useState<BricsSharedPrior | null>(null);
  const [privacyMode, setPrivacyMode] = useState<"aggregated" | "raw">("aggregated");
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.federatedNational(), api.federatedBrics()]).then(([n, b]) => {
      setNational(n);
      setBrics(b);
    });
  }, []);

  if (!national || !brics) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  const nationalChart = Object.entries(national.category_depletion_prior).map(([category, rate]) => ({
    category,
    rate,
  }));

  const bricsChart = Object.entries(brics.global_category_depletion_prior).map(([category, rate]) => ({
    category,
    rate,
  }));

  const isRawMode = privacyMode === "raw";

  return (
    <div className="space-y-6">
      <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -40; }
        }
        .animate-dash {
          stroke-dasharray: 8, 4;
          animation: dash 2s linear infinite;
        }
        @keyframes dashBlocked {
          to { stroke-dashoffset: -20; }
        }
        .animate-dash-blocked {
          stroke-dasharray: 4, 4;
          animation: dashBlocked 0.6s linear infinite;
        }
        @keyframes pulseNode {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50% { transform: scale(1.08); opacity: 1; }
        }
        .node-pulse {
          animation: pulseNode 3s ease-in-out infinite;
        }
      `}</style>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("federated")}</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">{t("onlyAggregates")}</p>
      </div>

      {/* Privacy Toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600">Show data flow as:</span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => setPrivacyMode("aggregated")}
            className={`px-4 py-2 text-sm font-medium transition-all flex items-center gap-1.5 ${
              !isRawMode
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Lock size={14} /> Aggregated Only (default)
          </button>
          <button
            onClick={() => setPrivacyMode("raw")}
            className={`px-4 py-2 text-sm font-medium transition-all border-l border-slate-200 flex items-center gap-1.5 ${
              isRawMode
                ? "bg-rose-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Ban size={14} /> Show Raw Data (blocked)
          </button>
        </div>
        {isRawMode && (
          <span className="flex items-center gap-1 text-xs text-rose-600 font-semibold animate-pulse">
            <AlertTriangle size={12} /> Raw data blocked — cannot cross node boundaries
          </span>
        )}
      </div>

      {/* Interactive Federated Network Visualizer */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 shadow-xl p-6 text-white relative overflow-hidden">
        <div className={`absolute top-4 right-4 text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1.5 border ${
          isRawMode
            ? "bg-rose-500/20 border-rose-500/30 text-rose-400"
            : "bg-brand-500/20 border-brand-500/30 text-brand-400 animate-pulse"
        }`}>
          {isRawMode ? <Ban size={12} /> : <ShieldCheck size={12} />}
          {isRawMode ? "RAW DATA — ACCESS BLOCKED" : "Privacy Guard: Secure Gradient Exchange Active"}
        </div>

        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">Live Federated Network</h2>
        <p className="text-xs text-slate-400 mb-6 max-w-lg">
          {isRawMode
            ? "Demonstrating what is BLOCKED: raw patient and PHC records cannot cross node boundaries. Only aggregated model weights flow."
            : "Aggregate local model weights (depletion coefficients) are exchanged between international nodes. Raw patient and PHC records never leave local storage."}
        </p>

        <div className="flex justify-center items-center py-4 bg-slate-950/60 rounded-xl border border-slate-800/80">
          <svg className="w-full max-w-[520px]" viewBox="0 0 440 320">
            {/* Connection lines */}
            {[
              { x1: 80, y1: 80, x2: 220, y2: 160 },
              { x1: 80, y1: 240, x2: 220, y2: 160 },
              { x1: 360, y1: 80, x2: 220, y2: 160 },
              { x1: 360, y1: 240, x2: 220, y2: 160 },
            ].map((line, idx) => (
              <g key={idx}>
                <line
                  x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
                  stroke={isRawMode ? "#ef4444" : "#0ea5e9"}
                  strokeWidth={isRawMode ? 2.5 : 2}
                  className={isRawMode ? "animate-dash-blocked" : "animate-dash"}
                  onMouseEnter={() => setHoveredLine(idx)}
                  onMouseLeave={() => setHoveredLine(null)}
                  style={{ cursor: "pointer" }}
                />
                {/* Blocked badge on hover */}
                {isRawMode && hoveredLine === idx && (
                  <text
                    x={(line.x1 + line.x2) / 2}
                    y={(line.y1 + line.y2) / 2 - 8}
                    fill="#ef4444"
                    fontSize="9"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    ACCESS DENIED
                  </text>
                )}
                {/* Data label on line when aggregated */}
                {!isRawMode && (
                  <text
                    x={(line.x1 + line.x2) / 2}
                    y={(line.y1 + line.y2) / 2 - 6}
                    fill="#7dd3fc"
                    fontSize="7"
                    textAnchor="middle"
                  >
                    ~14KB weights
                  </text>
                )}
              </g>
            ))}

            {/* Central Aggregator Node */}
            <circle cx="220" cy="160" r="30" fill={isRawMode ? "#7f1d1d" : "#4f46e5"} className="node-pulse" style={{ transformOrigin: "220px 160px" }} />
            <text x="220" y="157" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">CENTRAL</text>
            <text x="220" y="168" fill="#c7d2fe" fontSize="7" textAnchor="middle">AGGREGATOR</text>

            {/* India Node */}
            <circle cx="80" cy="80" r="22" fill="#ea580c" className="node-pulse" style={{ transformOrigin: "80px 80px" }} />
            <text x="80" y="77" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">INDIA</text>
            <text x="80" y="88" fill="#fed7aa" fontSize="7" textAnchor="middle">101 PHCs</text>

            {/* Brazil Node */}
            <circle cx="80" cy="240" r="22" fill="#16a34a" className="node-pulse" style={{ transformOrigin: "80px 240px" }} />
            <text x="80" y="237" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">BRAZIL</text>
            <text x="80" y="248" fill="#bbf7d0" fontSize="7" textAnchor="middle">partner</text>
            <text x="80" y="270" fill="#fbbf24" fontSize="6.5" fontWeight="bold" textAnchor="middle">SIMULATED</text>

            {/* South Africa Node */}
            <circle cx="360" cy="80" r="22" fill="#eab308" className="node-pulse" style={{ transformOrigin: "360px 80px" }} />
            <text x="360" y="77" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">S.AFRICA</text>
            <text x="360" y="88" fill="#fef08a" fontSize="7" textAnchor="middle">partner</text>
            <text x="360" y="110" fill="#fbbf24" fontSize="6.5" fontWeight="bold" textAnchor="middle">SIMULATED</text>

            {/* Egypt/Partner Node */}
            <circle cx="360" cy="240" r="22" fill="#64748b" className="node-pulse" style={{ transformOrigin: "360px 240px" }} />
            <text x="360" y="237" fill="#ffffff" fontSize="8" fontWeight="bold" textAnchor="middle">EGYPT</text>
            <text x="360" y="248" fill="#cbd5e1" fontSize="7" textAnchor="middle">partner</text>
            <text x="360" y="270" fill="#fbbf24" fontSize="6.5" fontWeight="bold" textAnchor="middle">SIMULATED</text>

            {/* Blocked X overlay in raw mode */}
            {isRawMode && (
              <>
                <line x1="185" y1="125" x2="255" y2="195" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
                <line x1="255" y1="125" x2="185" y2="195" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" />
              </>
            )}
          </svg>
        </div>

        {/* Model confidence — the network-effect number: more contributing
            nodes narrows the shared prior's confidence interval (see
            federated._model_confidence_score). Shown at both levels since
            they mix real (state) and simulated (BRICS partner) data. */}
        <div className="mt-5 bg-slate-800/60 border border-slate-700/40 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp size={13} /> Model Confidence
            </div>
            <span className="text-[10px] text-slate-500">grows as nodes join the federation</span>
          </div>
          <div className="space-y-3">
            <ConfidenceMeter
              label="National (state nodes → India)"
              nodeCount={national.contributing_nodes_count}
              score={national.model_confidence_score}
              barColor="bg-brand-400"
            />
            <ConfidenceMeter
              label="Global (India + BRICS partners)"
              nodeCount={brics.contributing_nodes_count}
              score={brics.model_confidence_score}
              barColor="bg-indigo-400"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Prediction confidence improves as more states join the federated network — each
            additional independent node narrows the shared prior's uncertainty (standard error
            shrinks with √n contributing nodes), the same reason federated averaging works at all.
          </p>
        </div>

        {/* What is blocked vs shared — side-by-side panel */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`rounded-lg p-4 border ${isRawMode ? "bg-rose-950/40 border-rose-700/40" : "bg-slate-800/60 border-slate-700/40"}`}>
            <div className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Ban size={13} /> Stays Local (NEVER shared)
            </div>
            <ul className="space-y-1.5">
              {RAW_DATA_BLOCKED.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
                  <item.icon size={13} className="shrink-0 text-slate-400" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-[10px] text-rose-500 font-semibold border border-rose-700/50 px-1.5 py-0.5 rounded">BLOCKED</span>
                </li>
              ))}
            </ul>
          </div>
          <div className={`rounded-lg p-4 border ${isRawMode ? "bg-slate-800/60 border-slate-700/40" : "bg-brand-950/40 border-brand-700/40"}`}>
            <div className="text-xs font-bold text-brand-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={13} /> What Gets Shared (aggregated only)
            </div>
            <ul className="space-y-1.5">
              {AGGREGATED_SHARED.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
                  <item.icon size={13} className="shrink-0 text-slate-400" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-[10px] text-brand-400 font-semibold border border-brand-700/50 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Check size={10} /> OK
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-slate-400 border-t border-slate-800/80 pt-3">
          <div className="flex items-center gap-1">
            <Lock size={11} /> Encryption: <span className="text-brand-400 font-semibold">Homomorphic (Paillier)</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertTriangle size={11} /> Patient Identifiers Leaked: <span className="text-green-400 font-semibold">0</span>
          </div>
          <div className="flex items-center gap-1">
            <Package size={11} /> Weight Payload: <span className="text-amber-400 font-semibold">~14.2 KB / node</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("nationalPrior")}</div>
        <div className="text-xs text-slate-400 mb-3">
          {national.participating_nodes.length} state nodes · {national.total_facilities} facilities
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={nationalChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="rate" fill="#0d9488" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-2 py-1">State node</th>
                <th className="text-left px-2 py-1">Facilities</th>
                <th className="text-left px-2 py-1">Critical</th>
                <th className="text-left px-2 py-1">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {national.node_summaries.map((n) => (
                <tr key={n.node}>
                  <td className="px-2 py-1 font-medium text-slate-800">{n.node}</td>
                  <td className="px-2 py-1 text-slate-600">{n.facility_count}</td>
                  <td className="px-2 py-1 text-rose-600 font-semibold">{n.critical_alerts}</td>
                  <td className="px-2 py-1 text-amber-600 font-semibold">{n.warning_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-semibold text-slate-700">{t("bricsPrior")}</div>
        </div>
        <div className="text-xs text-slate-400 mb-2">{brics.nodes.map((n) => n.node).join(" · ")}</div>
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          <FlaskConical size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>India</strong> reflects this platform's live generated PHC network. The BRICS partner
            nodes (Brazil, South Africa, Indonesia, Egypt) are a <strong>proof-of-concept</strong> for the
            federated architecture — their summaries are deterministically-seeded synthetic stand-ins,
            not a live connection to those countries' health systems. Real partner onboarding is future
            work, not implemented here.
          </span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={bricsChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="rate" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Global federated prior" />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-2 py-1">Nation node</th>
                <th className="text-left px-2 py-1">Facilities</th>
                <th className="text-left px-2 py-1">Critical</th>
                <th className="text-left px-2 py-1">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brics.nodes.map((n) => (
                <tr key={n.node}>
                  <td className="px-2 py-1 font-medium text-slate-800">
                    <span className="flex items-center gap-1.5">
                      {n.node}
                      {n.node !== "India" && (
                        <SimulatedDataBadge className="bg-amber-50! border-amber-200! text-amber-700!" />
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-slate-600">{n.facility_count.toLocaleString()}</td>
                  <td className="px-2 py-1 text-rose-600 font-semibold">{n.critical_alerts}</td>
                  <td className="px-2 py-1 text-amber-600 font-semibold">{n.warning_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3">{brics.note}</p>
      </div>
    </div>
  );
}
