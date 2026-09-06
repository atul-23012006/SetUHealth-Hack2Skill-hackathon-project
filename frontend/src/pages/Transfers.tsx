import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useLang } from "../lib/LangContext";
import type { Transfer, AuditEvent } from "../lib/types";

const KIND_STYLE: Record<string, string> = {
  transfer: "bg-teal-50 text-teal-700 border-teal-100",
  crisis: "bg-rose-50 text-rose-700 border-rose-100",
};

export default function Transfers() {
  const { t } = useLang();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fetchTransfers = () => {
    setLoading(true);
    Promise.all([api.listTransfers(), api.auditLog(60)]).then(([data, log]) => {
      // Sort newest first
      data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTransfers(data);
      setAudit(log);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const handleDownloadFhir = async (transferId: string) => {
    setDownloadingId(transferId);
    try {
      await api.downloadFhir(transferId);
    } catch (err) {
      console.error("FHIR export failed", err);
      alert("FHIR export failed. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

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
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg font-medium">
            📋 FHIR R4 export available per transfer
          </div>
          <button
            onClick={fetchTransfers}
            className="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50 cursor-pointer"
          >
            🔄 Refresh
          </button>
        </div>
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
                  <th className="px-6 py-3">Export</th>
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
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleDownloadFhir(tr.id)}
                        disabled={downloadingId === tr.id}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border font-semibold transition-all cursor-pointer bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:border-indigo-600 disabled:opacity-50"
                        title="Export as FHIR R4 SupplyRequest"
                      >
                        {downloadingId === tr.id ? "..." : "📋 FHIR R4"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SQLite-backed audit trail — every transfer, crisis and reset */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">🧾 {t("auditTrail")}</h2>
            <p className="text-[11px] text-slate-400">
              Persisted in SQLite — survives backend restarts
            </p>
          </div>
          <span className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded font-medium">
            {audit.length} events
          </span>
        </div>
        {audit.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No mutations recorded yet.</div>
        ) : (
          <ol className="relative border-l border-slate-200 ml-2 space-y-3">
            {audit.map((e, i) => (
              <li key={i} className="ml-4">
                <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-slate-300 border-2 border-white" />
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                      KIND_STYLE[e.kind] || "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {e.kind}
                  </span>
                  <span className="text-[11px] text-slate-400">{new Date(e.ts).toLocaleString()}</span>
                </div>
                <div className="text-sm text-slate-700 mt-0.5">{e.summary}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
