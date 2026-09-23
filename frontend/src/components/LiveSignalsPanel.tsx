import { useMemo, useState } from "react";
import { CloudRain, Droplets, RefreshCw, Sparkles, Thermometer, Wind, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";
import type { SignalLevel, StateWeather } from "../lib/types";

const LEVEL_RANK: Record<SignalLevel, number> = { high: 2, elevated: 1, normal: 0 };

const LEVEL_STYLE: Record<SignalLevel, { chip: string; dot: string; label: string }> = {
  high: { chip: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500", label: "High" },
  elevated: { chip: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", label: "Elevated" },
  normal: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "Normal" },
};

// Seven daily rainfall bars. Scaled to at least 25 mm so a dry week doesn't
// render its drizzle as a wall; the true value is in each bar's tooltip.
function RainBars({ daily }: { daily: StateWeather["daily"] }) {
  const peak = Math.max(25, ...daily.map((d) => d.rain_mm ?? 0));
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {daily.map((d) => {
        const mm = d.rain_mm ?? 0;
        return (
          <div
            key={d.date}
            title={`${d.date}: ${mm} mm`}
            className="w-full rounded-sm bg-gradient-to-t from-sky-500 to-sky-300 transition-all duration-700"
            style={{ height: `${Math.max(6, (mm / peak) * 100)}%`, opacity: mm === 0 ? 0.25 : 1 }}
          />
        );
      })}
    </div>
  );
}

function StateCard({ s, onLoad, justLoaded }: { s: StateWeather; onLoad: (state: string, crisis: string) => void; justLoaded: string | null }) {
  const { t } = useLang();
  const active = s.signals.filter((g) => g.level !== "normal");
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">{s.state}</div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1"><Droplets size={11} aria-hidden="true" />{s.current.humidity_pct ?? "–"}%</span>
            <span className="inline-flex items-center gap-1"><Wind size={11} aria-hidden="true" />{s.current.wind_kmh ?? "–"} km/h</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-slate-900">
            {s.current.temperature_c ?? "–"}<span className="text-sm font-medium text-slate-400">°C</span>
          </div>
          <div className="text-[11px] text-slate-400">{t("live.feels", { n: s.current.apparent_temperature_c ?? "–" })}</div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-slate-500">
          <span>{t("live.rain7")}</span>
          <span className="font-semibold text-slate-700">{s.rain_7d_mm} mm</span>
        </div>
        <RainBars daily={s.daily} />
      </div>

      <div className="mt-3 space-y-2">
        {active.length === 0 && (
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${LEVEL_STYLE.normal.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLE.normal.dot}`} /> {t("live.noSignals")}
          </div>
        )}
        {active.map((g) => (
          <div key={g.id} className="rounded-lg bg-slate-50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${LEVEL_STYLE[g.level].chip}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_STYLE[g.level].dot}`} />
                {t(`signal.${g.id}`)}: {t(`level.${g.level}`)}
              </span>
              {g.suggested_crisis && (
                <button
                  onClick={() => onLoad(s.state, g.suggested_crisis!)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                  title={t("live.simulateTitle", { crisis: g.suggested_crisis, state: s.state })}
                >
                  <Zap size={11} aria-hidden="true" /> {t("live.simulate")}
                </button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{g.reason}</p>
            {justLoaded === `${s.state}:${g.suggested_crisis}` && (
              <p className="animate-fade-in mt-1 text-[11px] font-medium text-brand-700">
                {t("live.loaded")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Real weather (Open-Meteo) per state, turned into operational signals. The
// "Simulate" buttons only pre-fill the crisis simulator; nothing mutates until
// the operator presses its own button.
export default function LiveSignalsPanel({ onLoadIntoSimulator }: { onLoadIntoSimulator: (state: string, crisis: string) => void }) {
  const { t } = useLang();
  const { data, error, loading, reload } = useAsync(() => api.liveStateWeather(), []);
  const [justLoaded, setJustLoaded] = useState<string | null>(null);

  const states = useMemo(
    () =>
      data
        ? [...data.states].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.rain_7d_mm - a.rain_7d_mm)
        : [],
    [data],
  );
  const flagged = states.filter((s) => s.level !== "normal").length;

  const handleLoad = (state: string, crisis: string) => {
    onLoadIntoSimulator(state, crisis);
    setJustLoaded(`${state}:${crisis}`);
    setTimeout(() => setJustLoaded(null), 6000);
  };

  return (
    <section id="live-signals" className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <CloudRain size={16} aria-hidden="true" className="text-sky-600" /> {t("live.title")}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-emerald-500" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("common.realData")}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            {t("live.desc")}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          {data && (
            <span>
              {data.stale ? t("live.stale") : ""}
              {t("live.updated", { time: new Date(data.fetched_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
            </span>
          )}
          <button
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden="true" /> {t("common.refresh")}
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-56" />)}
        </div>
      )}

      {error && !data && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <Thermometer size={16} aria-hidden="true" />
          {t("live.unavailable", { err: error })}
          <button onClick={reload} className="ml-auto rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold hover:bg-amber-100">
            {t("common.tryAgain")}
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="mt-4 flex items-center gap-2 text-xs text-slate-600">
            <Sparkles size={13} className="text-gold-500" aria-hidden="true" />
            {flagged === 0 ? t("live.summaryNone") : t("live.summary", { n: flagged, total: states.length })}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {states.map((s) => (
              <StateCard key={s.state} s={s} onLoad={handleLoad} justLoaded={justLoaded} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
