import { Link } from "react-router-dom";
import type { CapacityRecommendations } from "../lib/types";
import { useLang } from "../lib/LangContext";

export default function CapacityRedistributionList({ data }: { data: CapacityRecommendations | null }) {
  const { t } = useLang();
  if (!data) return null;
  const { beds, staff } = data;

  if (beds.length === 0 && staff.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">{t("noCapacityRecs")}</div>;
  }

  const row = (
    key: string,
    icon: string,
    fromName: string,
    fromId: string,
    toName: string,
    toId: string,
    action: string,
    dist: number,
    crossState: boolean,
    meta: string,
    high: boolean,
  ) => (
    <div key={key} className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="font-medium text-slate-900 text-sm flex items-center gap-1.5">
          <span>{icon}</span>
          <span className="text-teal-700">{action}</span>
          {high && <span className="text-[10px] font-bold text-rose-600 uppercase">● high</span>}
        </div>
        <div className="text-sm text-slate-500 truncate">
          {t("from")} <Link to={`/phcs/${fromId}`} className="font-medium text-slate-700 hover:underline">{fromName}</Link>
          {" → "}
          {t("to")} <Link to={`/phcs/${toId}`} className="font-medium text-slate-700 hover:underline">{toName}</Link>
          {crossState && <span className="ml-1 text-xs text-indigo-500 font-medium">cross-state</span>}
        </div>
        <div className="text-[11px] text-slate-400 mt-0.5">{meta}</div>
      </div>
      <div className="text-xs text-slate-400 shrink-0">{dist} km</div>
    </div>
  );

  return (
    <div className="divide-y divide-slate-100">
      {beds.length > 0 && (
        <div className="pt-1 pb-2">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1">🛏 Bed overflow</div>
          <div className="divide-y divide-slate-100">
            {beds.map((b, i) =>
              row(
                `bed-${i}`,
                "🛏",
                b.to_phc_name,
                b.to_phc_id,
                b.from_phc_name,
                b.from_phc_id,
                `${t("divertPatients")} ${b.patients} patient${b.patients === 1 ? "" : "s"}`,
                b.distance_km,
                b.cross_state,
                `donor at ${b.overflow_utilisation_pct}% bed occupancy`,
                b.severity === "high",
              ),
            )}
          </div>
        </div>
      )}
      {staff.length > 0 && (
        <div className="pt-2 pb-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">🧑‍⚕️ Staff shortage</div>
          <div className="divide-y divide-slate-100">
            {staff.map((s, i) =>
              row(
                `staff-${i}`,
                "🧑‍⚕️",
                s.from_phc_name,
                s.from_phc_id,
                s.to_phc_name,
                s.to_phc_id,
                `${t("lendStaff")} ${s.staff_fte} staff (FTE)`,
                s.distance_km,
                s.cross_state,
                `recipient at ${s.recipient_attendance_pct}% attendance`,
                s.severity === "high",
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
