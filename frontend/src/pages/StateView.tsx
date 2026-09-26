import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import PageLoader from "../components/PageLoader";
import { useAsync } from "../lib/useAsync";
import { useLang } from "../lib/LangContext";
import type { PHC, Forecast, RedistributionRec } from "../lib/types";
import AlertsList from "../components/AlertsList";
import RedistributionList from "../components/RedistributionList";

interface StateData {
  phcs: PHC[];
  alerts: Forecast[];
  recs: RedistributionRec[];
  medicines: any[];
}

export default function StateView() {
  const { state } = useParams<{ state: string }>();
  const { t } = useLang();

  const { data, loading, error, reload } = useAsync<StateData>(async () => {
    const [phcs, alerts, recs, medicines] = await Promise.all([
      api.phcs(state!), api.alerts(state!, 20), api.redistribution(state!), api.medicines(),
    ]);
    return { phcs, alerts, recs, medicines: medicines || [] };
  }, [state]);

  if (loading) return <PageLoader label={t("loading")} />;

  if (error || !data) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {error || t("loading")}
        <button onClick={reload} className="ml-auto rounded-md border border-amber-300 px-2 py-0.5 font-semibold hover:bg-amber-100">
          {t("common.retry")}
        </button>
      </div>
    );
  }
  const { phcs, alerts, recs, medicines } = data;

  return (
    <div className="space-y-6">
      <div id="state-header">
        <Link to="/" className="text-sm text-brand-600 hover:underline">
          ← {t("dashboard")}
        </Link>
        <h1 className="page-title mt-1">{state}</h1>
      </div>

      <div id="state-phc-table" className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">{t("district")}</th>
              <th className="text-left px-4 py-2">{t("beds")}</th>
              <th className="text-left px-4 py-2">{t("attendance")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {phcs.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link to={`/phcs/${p.id}`} className="text-brand-700 font-medium hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">{p.district}</td>
                <td className="px-4 py-2 text-slate-600">
                  {p.beds_occupied}/{p.beds_total}
                </td>
                <td className="px-4 py-2 text-slate-600">{p.attendance_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div id="state-alerts" className="card p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("stockoutAlerts")}</div>
          <AlertsList alerts={alerts} />
        </div>
        <div id="state-redistribution" className="card p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("redistributionRecs")}</div>
          <RedistributionList recs={recs} medicines={medicines} />
        </div>
      </div>
    </div>
  );
}
