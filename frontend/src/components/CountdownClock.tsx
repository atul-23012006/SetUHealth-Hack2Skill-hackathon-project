import { useEffect, useState } from "react";

interface Props {
  daysToStockout: number | null;
  medicine: string;
  phcName: string;
  district?: string;
  state?: string;
}

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00d 00h 00m 00s";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(d).padStart(2, "0")}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function CountdownClock({ daysToStockout, medicine, phcName, district, state }: Props) {
  const [seconds, setSeconds] = useState<number>(() =>
    daysToStockout != null ? Math.max(0, Math.round(daysToStockout * 86400)) : 0
  );

  useEffect(() => {
    if (daysToStockout == null || daysToStockout <= 0) return;
    const initialSeconds = Math.max(0, Math.round(daysToStockout * 86400));
    const startTime = Date.now();
    setSeconds(initialSeconds);
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setSeconds(Math.max(0, initialSeconds - elapsed));
    }, 1000);
    return () => clearInterval(id);
  }, [daysToStockout]);

  const isUrgent = (daysToStockout ?? 99) <= 3;

  return (
    <div
      className={`rounded-xl border p-3 flex flex-col gap-1.5 shadow-lg ${
        isUrgent
          ? "bg-rose-950 border-rose-700 shadow-rose-900/40"
          : "bg-amber-950 border-amber-700 shadow-amber-900/40"
      }`}
    >
      <div
        className={`text-[10px] font-bold uppercase tracking-widest ${
          isUrgent ? "text-rose-400" : "text-amber-400"
        }`}
      >
        {isUrgent ? "🚨 Critical Stockout" : "⚠️ Stockout Alert"}
      </div>
      <div className="text-white font-bold text-sm truncate">{medicine}</div>
      <div
        className={`font-mono font-black text-xl tabular-nums tracking-tight ${
          isUrgent ? "text-rose-200" : "text-amber-200"
        }`}
      >
        {formatCountdown(seconds)}
      </div>
      <div className="text-slate-400 text-[10px] truncate">
        {phcName}
        {district ? `, ${district}` : ""}
        {state ? `, ${state}` : ""}
      </div>
    </div>
  );
}
