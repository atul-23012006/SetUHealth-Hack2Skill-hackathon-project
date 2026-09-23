import { Joyride, EVENTS, type EventData, type Step, type TooltipRenderProps } from "react-joyride";
import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import type { TourStepDef } from "../lib/tours";
import { useLang } from "../lib/LangContext";

// Branded tooltip replacing Joyride's default box: progress bar, step counter,
// serif title and a pop-in animation. All buttons take their handlers from
// Joyride's own props, so keyboard and aria behaviour stay Joyride's.
function TourTooltip({
  index,
  size,
  step,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  closeProps,
  tooltipProps,
}: TooltipRenderProps) {
  const { t } = useLang();
  const pct = ((index + 1) / size) * 100;
  return (
    <div
      {...tooltipProps}
      className="animate-tour-pop w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-white text-left shadow-2xl ring-1 ring-slate-900/10"
    >
      <div className="h-1 bg-slate-100">
        <div
          className="h-full bg-gradient-to-r from-brand-500 to-gold-400 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-brand-700">
            <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Compass size={14} aria-hidden="true" />
            </span>
            {t("tour.step", { n: index + 1, total: size })}
          </div>
          <button
            {...closeProps}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {step.title && (
          <h3 className="mt-3 font-[family-name:var(--font-display)] text-lg font-semibold leading-snug text-slate-900">
            {step.title}
          </h3>
        )}
        <div className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.content}</div>
        <div className="mt-5 flex items-center justify-between gap-3">
          {isLastStep ? (
            <span />
          ) : (
            <button {...skipProps} className="text-xs font-medium text-slate-400 hover:text-slate-600">
              {t("tour.skip")}
            </button>
          )}
          <div className="flex items-center gap-2">
            {index > 0 && (
              <button
                {...backProps}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <ArrowLeft size={14} aria-hidden="true" /> {t("tour.back")}
              </button>
            )}
            <button
              {...primaryProps}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700"
            >
              {isLastStep ? (
                <>
                  {t("tour.finish")} <Check size={14} aria-hidden="true" />
                </>
              ) : (
                <>
                  {t("tour.next")} <ArrowRight size={14} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Props {
  run: boolean;
  steps: TourStepDef[];
  onFinish: () => void;
}

export default function GuidedTour({ run, steps, onFinish }: Props) {
  const { t } = useLang();
  const joyrideSteps: Step[] = steps.map((s) => ({
    target: s.target,
    title: s.title,
    content: s.content,
    placement: s.placement ?? "auto",
  }));

  const handleEvent = (data: EventData) => {
    if (data.type === EVENTS.TOUR_END) onFinish();
  };

  return (
    <Joyride
      run={run}
      steps={joyrideSteps}
      continuous
      scrollToFirstStep
      tooltipComponent={TourTooltip}
      locale={{ back: t("tour.back"), close: t("tour.close"), last: t("tour.finish"), next: t("tour.next"), skip: t("tour.skip") }}
      options={{
        primaryColor: "#0d9488",
        overlayColor: "rgba(4, 47, 46, 0.62)",
        zIndex: 10000,
        skipBeacon: true,
        spotlightRadius: 14,
        spotlightPadding: 8,
        scrollOffset: 110,
        overlayClickAction: false,
        buttons: ["back", "close", "skip", "primary"],
      }}
      onEvent={handleEvent}
    />
  );
}
