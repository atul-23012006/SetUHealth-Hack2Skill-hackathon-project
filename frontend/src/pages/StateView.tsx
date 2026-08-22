import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { PHC, Forecast, RedistributionRec } from "../lib/types";
import AlertsList from "../components/AlertsList";
import RedistributionList from "../components/RedistributionList";

export default function StateView() {
  const { state } = useParams<{ state: string }>();
  const { t } = useLang();
  const [phcs, setPhcs] = useState<PHC[]>([]);
  const [alerts, setAlerts] = useState<Forecast[]>([]);
  const [recs, setRecs] = useState<RedistributionRec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!state) return;
    setLoading(true);
    Promise.all([api.phcs(state), api.alerts(state, 20), api.redistribution(state)]).then(([p, a, r]) => {
      setPhcs(p);
      setAlerts(a);
      setRecs(r);
      setLoading(false);
    });
  }, [state]);

  if (loading) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-teal-600 hover:underline">
          ← {t("dashboard")}
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">{state}</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
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
                  <Link to={`/phcs/${p.id}`} className="text-teal-700 font-medium hover:underline">
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("stockoutAlerts")}</div>
          <AlertsList alerts={alerts} />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-semibold text-slate-700 mb-1">{t("redistributionRecs")}</div>
          <RedistributionList recs={recs} />
        </div>
      </div>
    </div>
  );
}
