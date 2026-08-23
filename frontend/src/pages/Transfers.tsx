import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { Transfer } from "../lib/types";

export default function Transfers() {
  const { t } = useLang();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransfers = () => {
    setLoading(true);
    api.listTransfers().then((data) => {
      // Sort newest first
      data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTransfers(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  if (loading) return <div className="text-center text-slate-400 py-20">{t("loading")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t("transferManifests")}</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tracking cross-district and cross-facility stock distributions executed across the grid.
          </p>
        </div>
        <button
          onClick={fetchTransfers}
          className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 cursor-pointer"
        >
          🔄 Refresh
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {transfers.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            No transfer manifests have been executed yet. Click "Execute" in the dashboard redistribution panel to log a manifest.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3">Manifest ID</th>
                  <th className="px-6 py-3">Medicine</th>
                  <th className="px-6 py-3">Quantity</th>
                  <th className="px-6 py-3">Donor Facility</th>
                  <th className="px-6 py-3">Recipient Facility</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Date / Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {transfers.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-mono font-semibold text-slate-900 text-xs">{tr.id}</td>
                    <td className="px-6 py-4 font-medium">{tr.medicine}</td>
                    <td className="px-6 py-4">
                      {tr.quantity} {tr.unit}
                    </td>
                    <td className="px-6 py-4">
                      <div>{tr.from_phc_name}</div>
                      <div className="text-xs text-slate-400">
                        {tr.from_district}, {tr.from_state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>{tr.to_phc_name}</div>
                      <div className="text-xs text-slate-400">
                        {tr.to_district}, {tr.to_state}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                        {tr.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(tr.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
