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

export default function StatCard({ label, value, tone = "default", thousands = false, icon: Icon, pulse = false }: Props) {
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
      <div className={`mt-2 text-3xl font-bold tabular-nums ${toneClasses[tone]}`}>{animatedValue}</div>
    </div>
  );
}
