import { useEffect, useRef, useState } from "react";

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

// Splits "42%" into { prefix: "", numeric: 42, suffix: "%", decimals: 0 }
// so the animated number can be re-assembled with its original formatting.
function parseValue(value: string | number) {
  const str = String(value);
  const match = str.match(/^([^\d-]*)(-?\d+(?:\.\d+)?)([^\d]*)$/);
  if (!match) return null;
  const [, prefix, numericStr, suffix] = match;
  const decimalIndex = numericStr.indexOf(".");
  const decimals = decimalIndex === -1 ? 0 : numericStr.length - decimalIndex - 1;
  return { prefix, numeric: parseFloat(numericStr), suffix, decimals };
}

function useCountUp(value: string | number, durationMs = 900): string {
  const [display, setDisplay] = useState(() => String(value));
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const parsed = parseValue(value);
    if (!parsed) {
      setDisplay(String(value));
      return;
    }
    const { prefix, numeric, suffix, decimals } = parsed;
    let startTime: number | null = null;

    const step = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = numeric * eased;
      setDisplay(`${prefix}${current.toFixed(decimals)}${suffix}`);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, durationMs]);

  return display;
}

export default function StatCard({ label, value, tone = "default" }: Props) {
  const animatedValue = useCountUp(value);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneClasses[tone]}`}>{animatedValue}</div>
    </div>
  );
}
