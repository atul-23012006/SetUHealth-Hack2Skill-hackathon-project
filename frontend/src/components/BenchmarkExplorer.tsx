import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ExternalLink, Globe2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";

const COLORS: Record<string, string> = {
  IND: "#e8b930", BRA: "#16a34a", RUS: "#6366f1", CHN: "#ef4444", ZAF: "#0ea5e9",
  EGY: "#a855f7", ETH: "#14b8a6", IRN: "#f97316", ARE: "#64748b", IDN: "#84cc16",
};
const CORE = ["IND", "BRA", "RUS", "CHN", "ZAF"];

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Real health-system indicators (World Bank) for BRICS countries. The federated
// node summaries elsewhere on this page are simulated; this panel is not.
export default function BenchmarkExplorer() {
  const { t: tr } = useLang();
  // World Bank labels/units/countries arrive in English from the API; show the
  // translation when we have one and fall back to the API's own text otherwise.
  const indLabel = (id: string, fallback: string) => { const k = `bench.ind.${id}`; const v = tr(k); return v === k ? fallback : v; };
  const indUnit = (id: string, fallback: string) => { const k = `bench.unit.${id}`; const v = tr(k); return v === k ? fallback : v; };
  const countryName = (iso: string, fallback: string) => { const k = `country.${iso}`; const v = tr(k); return v === k ? fallback : v; };
  const catalog = useAsync(() => api.liveBenchmarkCatalog(), []);
  const [indicator, setIndicator] = useState("SH.MED.BEDS.ZS");
  const [selected, setSelected] = useState<string[]>(CORE);
  const [hover, setHover] = useState<string | null>(null);

  const key = selected.join(",");
  const series = useAsync(() => api.liveBenchmarks(indicator, selected), [indicator, key]);
  const data = series.data;

  const toggle = (iso: string) =>
    setSelected((cur) => (cur.includes(iso) ? (cur.length > 1 ? cur.filter((c) => c !== iso) : cur) : [...cur, iso]));

  // One row per year, one column per country, for Recharts.
  const chartRows = useMemo(() => {
    if (!data) return [];
    const byYear = new Map<number, Record<string, number>>();
    for (const c of data.countries) {
      for (const p of c.series) {
        byYear.set(p.year, { ...(byYear.get(p.year) ?? {}), [c.iso3]: p.value });
      }
    }
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, vals]) => ({ year, ...vals }));
  }, [data]);

  const ranking = useMemo(
    () => (data ? data.countries.filter((c) => c.latest).sort((a, b) => b.latest!.value - a.latest!.value) : []),
    [data],
  );
  const maxValue = Math.max(...ranking.map((c) => c.latest!.value), 0.0001);

  const india = ranking.find((c) => c.iso3 === "IND");
  const others = ranking.filter((c) => c.iso3 !== "IND").map((c) => c.latest!.value);
  const gap = india && others.length ? ((india.latest!.value - median(others)) / median(others)) * 100 : null;
  const higherIsBetter = data?.indicator.higher_is_better ?? true;
  const indiaBetter = gap !== null && (higherIsBetter ? gap > 0 : gap < 0);

  return (
    <div id="fed-benchmarks" className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Globe2 size={16} className="text-brand-600" aria-hidden="true" /> {tr("bench.title")}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {tr("common.realData")}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {tr("bench.desc")}
          </p>
        </div>
        {data && (
          <a href={data.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-brand-700">
            World Bank · {data.indicator.id} <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>

      {/* Indicator picker */}
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Health indicator">
        {catalog.data?.indicators.map((i) => (
          <button
            key={i.id}
            role="tab"
            aria-selected={indicator === i.id}
            onClick={() => setIndicator(i.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              indicator === i.id ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50"
            }`}
          >
            {indLabel(i.id, i.label)}
          </button>
        ))}
        {catalog.loading && !catalog.data && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-7 w-24 !rounded-full" />)}
      </div>

      {/* Country chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-slate-400">{tr("bench.countries")}</span>
        {catalog.data?.countries.map((c) => {
          const on = selected.includes(c.iso3);
          return (
            <button
              key={c.iso3}
              onClick={() => toggle(c.iso3)}
              // Only a plotted country can be isolated; hovering a deselected chip must not dim every line.
              onMouseEnter={() => on && setHover(c.iso3)}
              onMouseLeave={() => setHover(null)}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                on ? "border-slate-300 bg-white text-slate-800" : "border-dashed border-slate-200 text-slate-400 hover:text-slate-600"
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: on ? COLORS[c.iso3] : "#cbd5e1" }} />
              {countryName(c.iso3, c.name)}
            </button>
          );
        })}
      </div>

      {series.loading && !data && <div className="skeleton mt-4 h-72" />}
      {series.error && !data && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} aria-hidden="true" /> {tr("bench.unavailable", { err: series.error })}
          <button onClick={series.reload} className="ml-auto rounded-md border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100">{tr("common.retry")}</button>
        </div>
      )}

      {data && (
        <div className={`mt-4 transition-opacity ${series.loading ? "opacity-60" : "opacity-100"}`}>
          {gap !== null && india && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${indiaBetter ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
              {indiaBetter ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownRight size={16} aria-hidden="true" />}
              <span>
                {tr("bench.insight", {
                  label: indLabel(data.indicator.id, data.indicator.label).toLowerCase(),
                  value: india.latest!.value.toLocaleString(undefined, { maximumFractionDigits: 2 }),
                  unit: indUnit(data.indicator.id, data.indicator.unit),
                  year: india.latest!.year,
                  pct: Math.abs(gap).toFixed(0),
                  dir: gap > 0 ? tr("bench.above") : tr("bench.below"),
                  better: higherIsBetter ? tr("bench.higherBetter") : tr("bench.lowerBetter"),
                })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="mb-1 text-xs font-semibold text-slate-600">{indLabel(data.indicator.id, data.indicator.label)}, {indUnit(data.indicator.id, data.indicator.unit)}</div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart key={`${data.indicator.id}:${key}`} data={chartRows} margin={{ left: -10, right: 8, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {data.countries.map((c) => (
                    <Line
                      key={c.iso3}
                      type="monotone"
                      dataKey={c.iso3}
                      name={countryName(c.iso3, c.name)}
                      stroke={COLORS[c.iso3]}
                      strokeWidth={c.iso3 === "IND" || hover === c.iso3 ? 3.5 : 1.8}
                      strokeOpacity={hover && hover !== c.iso3 ? 0.2 : 1}
                      dot={false}
                      connectNulls
                      animationDuration={900}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="lg:col-span-2">
              <div className="mb-2 text-xs font-semibold text-slate-600">{tr("bench.latest")}</div>
              <ul className="space-y-1.5">
                {ranking.map((c) => (
                  <li
                    key={c.iso3}
                    onMouseEnter={() => setHover(c.iso3)}
                    onMouseLeave={() => setHover(null)}
                    className={`rounded-lg px-2 py-1.5 transition-colors ${hover === c.iso3 ? "bg-slate-50" : ""}`}
                  >
                    <div className="flex items-baseline justify-between text-xs">
                      <span className={`font-medium ${c.iso3 === "IND" ? "text-gold-600" : "text-slate-700"}`}>{countryName(c.iso3, c.name)}</span>
                      <span className="tabular-nums text-slate-500">
                        <strong className="text-slate-800">{c.latest!.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                        <span className="text-slate-400"> · {c.latest!.year}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(c.latest!.value / maxValue) * 100}%`, background: COLORS[c.iso3] }} />
                    </div>
                  </li>
                ))}
              </ul>
              {data.countries.some((c) => !c.latest) && (
                <p className="mt-2 text-[11px] text-slate-400">
                  {tr("bench.noData", { list: data.countries.filter((c) => !c.latest).map((c) => countryName(c.iso3, c.name)).join(", ") })}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {tr("bench.source", { source: data.source })}
              {data.stale ? " " + tr("live.stale") : ""}
            </span>
            <button onClick={series.reload} className="inline-flex items-center gap-1 hover:text-slate-600">
              <RefreshCw size={10} aria-hidden="true" /> {tr("common.refresh")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
