interface Props {
  label: string;
  value: string | number;
  tone?: "default" | "critical" | "warning" | "good";
}

const toneClasses: Record<string, string> = {
  default: "text-slate-900",
  critical: "text-rose-600",
  warning: "text-amber-600",
  good: "text-emerald-600",
};

export default function StatCard({ label, value, tone = "default" }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneClasses[tone]}`}>{value}</div>
    </div>
  );
}
