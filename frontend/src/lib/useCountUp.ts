import { useEffect, useRef, useState } from "react";

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

export function useCountUp(value: string | number, durationMs = 900): string {
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
