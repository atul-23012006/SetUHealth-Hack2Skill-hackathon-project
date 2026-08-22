import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { NationalFederatedPrior, BricsSharedPrior } from "../lib/types";

export default function Federated() {
  const { t } = useLang();
  const [national, setNational] = useState<NationalFederatedPrior | null>(null);
  const [brics, setBrics] = useState<BricsSharedPrior | null>(null);

  useEffect(() => {
    Promise.all([api.federatedNational(), api.federatedBrics()]).then(([n, b]) => {
      setNational(n);
      setBrics(b);
    });
  }, []);

  if (!national || !brics) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  const nationalChart = Object.entries(national.category_depletion_prior).map(([category, rate]) => ({
    category,
    rate,
  }));

  const bricsChart = Object.entries(brics.global_category_depletion_prior).map(([category, rate]) => ({
    category,
    rate,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t("federated")}</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">{t("onlyAggregates")}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("nationalPrior")}</div>
        <div className="text-xs text-slate-400 mb-3">
          {national.participating_nodes.length} state nodes · {national.total_facilities} facilities
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={nationalChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="rate" fill="#0d9488" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-2 py-1">State node</th>
                <th className="text-left px-2 py-1">Facilities</th>
                <th className="text-left px-2 py-1">Critical</th>
                <th className="text-left px-2 py-1">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {national.node_summaries.map((n) => (
                <tr key={n.node}>
                  <td className="px-2 py-1 font-medium text-slate-800">{n.node}</td>
                  <td className="px-2 py-1 text-slate-600">{n.facility_count}</td>
                  <td className="px-2 py-1 text-rose-600 font-semibold">{n.critical_alerts}</td>
                  <td className="px-2 py-1 text-amber-600 font-semibold">{n.warning_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="text-sm font-semibold text-slate-700 mb-1">{t("bricsPrior")}</div>
        <div className="text-xs text-slate-400 mb-3">{brics.nodes.map((n) => n.node).join(" · ")}</div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={bricsChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
            <XAxis dataKey="category" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="rate" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Global federated prior" />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-2 py-1">Nation node</th>
                <th className="text-left px-2 py-1">Facilities</th>
                <th className="text-left px-2 py-1">Critical</th>
                <th className="text-left px-2 py-1">Warning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brics.nodes.map((n) => (
                <tr key={n.node}>
                  <td className="px-2 py-1 font-medium text-slate-800">{n.node}</td>
                  <td className="px-2 py-1 text-slate-600">{n.facility_count.toLocaleString()}</td>
                  <td className="px-2 py-1 text-rose-600 font-semibold">{n.critical_alerts}</td>
                  <td className="px-2 py-1 text-amber-600 font-semibold">{n.warning_alerts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-3">{brics.note}</p>
      </div>
    </div>
  );
}
