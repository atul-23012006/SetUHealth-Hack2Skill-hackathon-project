import type { LucideIcon } from "lucide-react";
import { useCountUp } from "../lib/useCountUp";

interface Props {
  label: string;
  value: string | number;
  tone?: "default" | "critical" | "warning" | "good";
  thousands?: boolean;
  icon?: LucideIcon;
  /** Ring that pings around the icon, for a tile that needs attention. */
  pulse?: boolean;
  /** Change since a reference point (e.g. before a crisis simulation). Hidden when 0. */
  delta?: { value: number; suffix?: string; worseWhen: "up" | "down"; label?: string };
}

const toneClasses: Record<string, string> = {
  default: "text-slate-900",
  critical: "text-rose-600",
  warning: "text-amber-600",
  good: "text-emerald-600",
};

const accentBar: Record<string, string> = {
  default: "from-slate-300 to-slate-400",
  critical: "from-rose-500 to-rose-300",
  warning: "from-amber-500 to-amber-300",
  good: "from-emerald-500 to-brand-300",
};

const iconTint: Record<string, string> = {
  default: "bg-slate-100 text-slate-600",
  critical: "bg-rose-50 text-rose-600",
  warning: "bg-amber-50 text-amber-600",
  good: "bg-emerald-50 text-emerald-600",
};

export default function StatCard({ label, value, tone = "default", thousands = false, icon: Icon, pulse = false, delta }: Props) {
  const animatedValue = useCountUp(value, 1100, thousands);
  return (
    <div className="card card-lift relative overflow-hidden p-4">
      <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accentBar[tone]}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        {Icon && (
          <span className={`relative grid h-8 w-8 shrink-0 place-items-center rounded-lg ${iconTint[tone]}`}>
            {pulse && <span className="absolute inset-0 animate-ping-soft rounded-lg bg-current" aria-hidden="true" />}
            <Icon size={16} aria-hidden="true" />
          </span>
        )}
      </div>
      {/* text-2xl on narrow screens: a `thousands`-formatted value like
          population_served ("4,601,642") crowds a 2-col mobile grid card at
          text-3xl; sm: restores the larger size where there's more room. */}
      <div className={`mt-2 text-2xl font-bold tabular-nums sm:text-3xl ${toneClasses[tone]}`}>{animatedValue}</div>
      {delta && delta.value !== 0 && (() => {
        const worse = (delta.value > 0) === (delta.worseWhen === "up");
        return (
          <div
            key={delta.value}
            className={`change-flash mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
              worse ? "text-rose-700 ring-1 ring-rose-200" : "text-emerald-700 ring-1 ring-emerald-200"
            }`}
          >
            {delta.value > 0 ? "▲ +" : "▼ −"}{Math.abs(delta.value).toLocaleString()}{delta.suffix ?? ""}
            <span className="font-medium text-slate-500">{delta.label ?? "vs. before simulation"}</span>
          </div>
        );
      })()}
    </div>
  );
}
