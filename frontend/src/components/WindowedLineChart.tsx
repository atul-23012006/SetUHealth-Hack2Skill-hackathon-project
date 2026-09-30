import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Brush, ResponsiveContainer } from "recharts";

const DEFAULT_WINDOW = 60;
const MAX_VISIBLE_TICKS = 8;

interface Props {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  stroke: string;
  yDomain?: [number, number];
  height?: number;
}

/**
 * A date-indexed daily-history line chart (used for a full year of data).
 * Rendering all ~365 points at once crowds the x-axis into overlapping,
 * unreadable labels, so this defaults to the most recent ~60 days and adds a
 * Brush underneath — drag its handles, or the mini-chart itself, to scrub
 * through the rest of the year without losing readability.
 */
export default function WindowedLineChart({ data, dataKey, stroke, yDomain, height = 180 }: Props) {
  const [range, setRange] = useState<[number, number]>(() => [
    Math.max(0, data.length - DEFAULT_WINDOW),
    Math.max(0, data.length - 1),
  ]);

  // Data can swap out from under this component (switching PHC / medicine) —
  // clamp the window instead of leaving it pointed past the new array's end.
  useEffect(() => {
    setRange(([start, end]) => {
      const lastIndex = Math.max(0, data.length - 1);
      const clampedEnd = Math.min(end, lastIndex);
      const clampedStart = Math.min(start, clampedEnd);
      return [clampedStart, clampedEnd];
    });
  }, [data.length]);

  // Brush windows the chart's own `data` internally (its built-in behavior) —
  // the chart below is given the full array, and only the brushed slice of it
  // ever reaches the axes. `range` here just mirrors that for the tick-count math.
  const windowedLength = range[1] - range[0] + 1;
  const tickInterval = Math.max(0, Math.ceil(windowedLength / MAX_VISIBLE_TICKS) - 1);
  const showBrush = data.length > DEFAULT_WINDOW;

  return (
    <ResponsiveContainer width="100%" height={showBrush ? height + 28 : height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={tickInterval} />
        <YAxis tick={{ fontSize: 11 }} domain={yDomain} width={36} />
        <Tooltip />
        <Line type="monotone" dataKey={dataKey} stroke={stroke} dot={false} strokeWidth={2} isAnimationActive={false} />
        {showBrush && (
          <Brush
            dataKey="date"
            height={20}
            stroke={stroke}
            travellerWidth={8}
            startIndex={range[0]}
            endIndex={range[1]}
            onChange={(r: { startIndex?: number; endIndex?: number }) => {
              if (r.startIndex == null || r.endIndex == null) return;
              setRange([r.startIndex, r.endIndex]);
            }}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
