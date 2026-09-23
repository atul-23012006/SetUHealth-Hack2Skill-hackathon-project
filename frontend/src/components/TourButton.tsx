import { lazy, Suspense, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Compass, Loader2 } from "lucide-react";
// Joyride is only needed once a tour starts.
const GuidedTour = lazy(() => import("./GuidedTour"));
import { tourForPath, type TourStepDef } from "../lib/tours";
import { useLang } from "../lib/LangContext";

const SEEN_PREFIX = "setuhealth_tour_seen:";

// Storage can be unavailable (private mode, blocked site data). Treat that as
// "seen" so the discoverability pulse never becomes permanent.
function hasSeen(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + id) === "1";
  } catch {
    return true;
  }
}

function markSeen(id: string) {
  try {
    localStorage.setItem(SEEN_PREFIX + id, "1");
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pages render a loading skeleton first and their anchors mount later, and
// entrance animations shift elements while they play. Starting Joyride before
// either settles would spotlight the wrong place, so wait for (a) at least one
// target to exist and (b) finite animations to finish, then keep only the steps
// whose target is actually on screen.
async function resolveTourSteps(steps: TourStepDef[], timeoutMs = 5000): Promise<TourStepDef[]> {
  const exists = (sel: string) => document.querySelector(sel) !== null;
  const started = performance.now();
  while (!steps.some((s) => exists(s.target)) && performance.now() - started < timeoutMs) {
    await sleep(120);
  }
  const finite = document
    .getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
  await Promise.race([Promise.allSettled(finite.map((a) => a.finished)), sleep(1600)]);
  return steps.filter((s) => exists(s.target));
}

interface Props {
  /** "light" for the white console header, "dark" for the public portal's. */
  tone?: "light" | "dark";
}

export default function TourButton({ tone = "light" }: Props) {
  const { pathname } = useLocation();
  const { t } = useLang();
  const tour = useMemo(() => tourForPath(pathname), [pathname]);
  const [steps, setSteps] = useState<TourStepDef[]>([]);
  const [run, setRun] = useState(false);
  const [runId, setRunId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Remounted per page (the layouts key this component by pathname), so a tour
  // never outlives the page it was started on and `seen` is re-read per page.
  const [seen, setSeen] = useState(() => (tour ? hasSeen(tour.id) : true));

  if (!tour) return null;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const resolved = await resolveTourSteps(tour.steps);
    setBusy(false);
    if (resolved.length === 0) {
      setNotice(t("tour.notReady"));
      setTimeout(() => setNotice(null), 3000);
      return;
    }
    markSeen(tour.id);
    setSeen(true);
    setSteps(resolved);
    setRunId((n) => n + 1); // fresh Joyride instance, so a repeat always starts at step 1
    setRun(true);
  };

  const styles =
    tone === "dark"
      ? "border-brand-700 text-brand-200 hover:bg-brand-900/40"
      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:border-brand-300";

  return (
    <>
      {steps.length > 0 && (
        <Suspense fallback={null}>
          <GuidedTour key={runId} run={run} steps={steps} onFinish={() => setRun(false)} />
        </Suspense>
      )}
      <div className="relative">
        <button
          type="button"
          onClick={start}
          disabled={busy}
          title={t("tour.buttonTitle", { name: tour.name })}
          className={`relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${styles}`}
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <Compass size={15} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{t("nav.takeTour")}</span>
          {!seen && !busy && (
            <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-gold-400" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold-500" />
            </span>
          )}
        </button>
        {notice && (
          <div
            role="status"
            className="animate-fade-in absolute right-0 top-full z-30 mt-2 w-56 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
          >
            {notice}
          </div>
        )}
      </div>
    </>
  );
}
