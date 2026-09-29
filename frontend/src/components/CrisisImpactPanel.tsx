import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BedDouble, Building2, FlaskConical, Pill, Thermometer, TrendingDown, Users, AlertTriangle } from "lucide-react";
import type { CrisisChange, CrisisImpact } from "../lib/types";
import RiskBadge from "./RiskBadge";

type Kind = CrisisChange["kind"];

const KIND_META: Record<Kind, { label: string; icon: typeof Pill }> = {
  stock: { label: "Stock", icon: Pill },
  beds: { label: "Beds", icon: BedDouble },
  footfall: { label: "OPD visits", icon: Users },
  temperature: { label: "Cold chain", icon: Thermometer },
};

const PAGE = 12;

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** Before/after bars on one scale: grey = before, rose = after. */
function DiffBar({ before, after, max }: { before: number; after: number; max: number }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / (max || 1)) * 100))}%`;
  return (
    <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: pct(before) }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-rose-500/80" style={{ width: pct(after), height: "50%", top: "25%" }} />
    </div>
  );
}

function Delta({ change }: { change: CrisisChange }) {
  const d = change.after - change.before;
  const rel = change.before !== 0 ? Math.round((d / Math.abs(change.before)) * 100) : null;
  // Every crisis change is a deterioration: less stock, more load, hotter fridges.
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-rose-700 ring-1 ring-rose-200">
      {d > 0 ? "▲" : "▼"} {d > 0 ? "+" : "−"}{fmt(Math.abs(d))}
      {rel != null && <span className="font-medium text-rose-500">({rel > 0 ? "+" : ""}{rel}%)</span>}
    </span>
  );
}

export default function CrisisImpactPanel({ impacts }: { impacts: CrisisImpact[] }) {
  const [selected, setSelected] = useState(0);
  const [kind, setKind] = useState<Kind | "all">("all");
  const [showAll, setShowAll] = useState(false);

  const impact = impacts[Math.min(selected, impacts.length - 1)];

  const counts = useMemo(() => {
    const c: Partial<Record<Kind, number>> = {};
    for (const ch of impact?.changes ?? []) c[ch.kind] = (c[ch.kind] ?? 0) + 1;
    return c;
  }, [impact]);

  if (!impact) return null;

  const rows = impact.changes.filter((c) => kind === "all" || c.kind === kind);
  const visible = showAll ? rows : rows.slice(0, PAGE);
  const t = impact.totals;
  const time = new Date(impact.triggered_at).toLocaleTimeString();

  const tiles = [
    { label: "Facilities hit", value: t.facilities_affected, icon: Building2, show: true },
    { label: "Newly critical", value: t.newly_critical, icon: AlertTriangle, show: t.newly_critical > 0 },
    { label: "Stock units lost", value: t.stock_units_lost, icon: TrendingDown, show: t.stock_units_lost > 0 },
    { label: "Beds filled", value: t.beds_newly_occupied, icon: BedDouble, show: t.beds_newly_occupied > 0, plus: true },
    { label: "Extra OPD visits", value: t.extra_opd_visits, icon: Users, show: t.extra_opd_visits > 0, plus: true },
    { label: "Cold-chain alerts", value: t.cold_chain_alerts_raised, icon: Thermometer, show: t.cold_chain_alerts_raised > 0, plus: true },
  ].filter((x) => x.show);

  return (
    <section id="crisis-impact" className="card overflow-hidden border-rose-200" aria-label="Simulation impact">
      <div className="flex flex-col gap-3 border-b border-rose-100 bg-rose-50/60 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-bold text-slate-900">
              <FlaskConical size={16} className="text-rose-600" /> What the simulation changed
            </h2>
            <span className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
              Simulated data
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-rose-500" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              Live · applied {time}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            <strong>{impact.crisis_type}</strong> in {impact.target_type} <strong>{impact.target_name}</strong>. Every value
            below was rewritten by the simulator: <span className="text-slate-400 line-through">before</span>{" "}
            <ArrowRight size={11} className="inline" /> <span className="font-semibold text-rose-700">after</span>.
          </p>
        </div>
        {impacts.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Simulated crises">
            {impacts.map((im, i) => (
              <button
                key={im.triggered_at + i}
                role="tab"
                aria-selected={i === selected}
                onClick={() => { setSelected(i); setShowAll(false); }}
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
                  i === selected ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                }`}
              >
                {im.crisis_type} — {im.target_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div key={impact.triggered_at} className="grid grid-cols-2 gap-2 px-5 pt-4 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(({ label, value, icon: Icon, plus }) => (
          <div key={label} className="change-flash rounded-lg border border-slate-200 px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Icon size={11} /> {label}
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-rose-700">
              {plus ? "+" : ""}{fmt(value)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 px-5 pt-4" role="tablist" aria-label="Change type">
        {(["all", "stock", "beds", "footfall", "temperature"] as const).map((k) => {
          const n = k === "all" ? impact.changes.length : counts[k] ?? 0;
          if (k !== "all" && n === 0) return null;
          return (
            <button
              key={k}
              role="tab"
              aria-selected={kind === k}
              onClick={() => { setKind(k); setShowAll(false); }}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                kind === k ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {k === "all" ? "All" : KIND_META[k].label} <span className="opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto px-5 py-3">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-semibold">Facility</th>
              <th className="py-2 pr-3 font-semibold">What changed</th>
              <th className="py-2 pr-3 font-semibold">Before → After</th>
              <th className="py-2 pr-3 font-semibold">Change</th>
              <th className="py-2 pr-3 font-semibold">Risk</th>
              <th className="py-2 font-semibold">Days to stockout</th>
            </tr>
          </thead>
          <tbody key={impact.triggered_at + kind}>
            {visible.map((c, i) => {
              const Icon = KIND_META[c.kind].icon;
              const max = c.kind === "beds" && c.capacity ? c.capacity : Math.max(c.before, c.after);
              const escalated = c.risk_before && c.risk_after && c.risk_before !== c.risk_after;
              return (
                <tr
                  key={`${c.phc_id}-${c.kind}-${c.item}`}
                  className="change-flash border-t border-slate-100 align-middle"
                  style={{ animationDelay: `${Math.min(i, 12) * 60}ms` }}
                >
                  <td className="py-2 pr-3">
                    <Link to={`/phcs/${c.phc_id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                      {c.phc_name}
                    </Link>
                    <div className="text-[11px] text-slate-500">{c.district}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-700">
                      <Icon size={13} className="text-slate-400" /> {c.item}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-1.5 tabular-nums">
                      <span className="text-slate-400 line-through">{fmt(c.before)}</span>
                      <ArrowRight size={12} className="text-slate-400" />
                      <span className="font-bold text-rose-700">{fmt(c.after)}</span>
                      <span className="text-[11px] text-slate-400">{c.unit}</span>
                    </div>
                    <div className="mt-1"><DiffBar before={c.before} after={c.after} max={max} /></div>
                  </td>
                  <td className="py-2 pr-3"><Delta change={c} /></td>
                  <td className="py-2 pr-3">
                    {c.risk_before && c.risk_after ? (
                      escalated ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="opacity-60"><RiskBadge risk={c.risk_before} /></span>
                          <ArrowRight size={11} className="text-slate-400" />
                          <RiskBadge risk={c.risk_after} />
                        </span>
                      ) : (
                        <RiskBadge risk={c.risk_after} />
                      )
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2 tabular-nums text-xs">
                    {c.days_before !== undefined ? (
                      <span>
                        <span className="text-slate-400">{fmt(c.days_before)}</span>
                        {c.days_before !== c.days_after && (
                          <> <ArrowRight size={10} className="inline text-slate-400" /> <span className="font-semibold text-rose-700">{fmt(c.days_after)}</span></>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No values of this type changed.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-slate-500">
          <span>
            Showing {visible.length} of {rows.length} changes
            {impact.rows_total > impact.changes.length && ` (the ${impact.changes.length} most severe of ${impact.rows_total})`}
            , most severe first.
          </span>
          {rows.length > PAGE && (
            <button onClick={() => setShowAll((s) => !s)} className="font-semibold text-brand-700 hover:underline">
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
