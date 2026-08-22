import type { Risk } from "../lib/types";
import { useLang } from "../lib/LangContext";

const styles: Record<Risk, string> = {
  critical: "bg-rose-100 text-rose-700 border-rose-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function RiskBadge({ risk }: { risk: Risk }) {
  const { t } = useLang();
  const label = risk === "critical" ? t("critical") : risk === "warning" ? t("warning") : t("low");
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[risk]}`}>
      {label}
    </span>
  );
}
