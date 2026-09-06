import axios from "axios";
import type {
  PHC,
  PHCDetail,
  Medicine,
  Forecast,
  RedistributionRec,
  NationalFederatedPrior,
  BricsSharedPrior,
  Transfer,
  ActiveCrisis,
  ConsumptionAnomaly,
  CapacityRecommendations,
  AuditEvent,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const client = axios.create({ baseURL: BASE_URL });

export const api = {
  states: () => client.get<Record<string, string[]>>("/api/states").then((r) => r.data),
  phcs: (state?: string, district?: string) =>
    client.get<PHC[]>("/api/phcs", { params: { state, district } }).then((r) => r.data),
  phc: (id: string) => client.get<PHCDetail>(`/api/phcs/${id}`).then((r) => r.data),
  medicines: () => client.get<Medicine[]>("/api/medicines").then((r) => r.data),
  alerts: (state?: string, limit = 20) =>
    client.get<Forecast[]>("/api/alerts", { params: { state, limit } }).then((r) => r.data),
  explainAlert: (phcId: string, medicine: string, lang: string) =>
    client
      .get<{ explanation: string }>(`/api/alerts/${phcId}/${encodeURIComponent(medicine)}/explain`, {
        params: { lang },
      })
      .then((r) => r.data.explanation),
  forecastAll: (state?: string) => client.get<Forecast[]>("/api/forecast", { params: { state } }).then((r) => r.data),
  redistribution: (state?: string, explain?: boolean, lang?: string) =>
    client.get<RedistributionRec[]>("/api/redistribution", { params: { state, explain, lang } }).then((r) => r.data),

  federatedNational: () => client.get<NationalFederatedPrior>("/api/federated/national").then((r) => r.data),
  federatedBrics: () => client.get<BricsSharedPrior>("/api/federated/brics").then((r) => r.data),
  chat: (query: string, lang: string, state?: string) =>
    client.post<{ reply: string }>("/api/assistant/chat", { query, lang, state }).then((r) => r.data.reply),
  listTransfers: () => client.get<Transfer[]>("/api/transfers").then((r) => r.data),
  executeTransfer: (from_phc_id: string, to_phc_id: string, medicine: string, quantity: number) => {
    if (!navigator.onLine) {
      const offlineQueue = JSON.parse(localStorage.getItem("offline_transfers") || "[]");
      const tempId = `TEMP-TR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const mockManifest: Transfer = {
        id: tempId,
        medicine,
        unit: "units",
        from_phc_id,
        from_phc_name: `PHC ${from_phc_id}`,
        from_state: "",
        from_district: "",
        to_phc_id,
        to_phc_name: `PHC ${to_phc_id}`,
        to_state: "",
        to_district: "",
        quantity,
        status: "Pending (Offline)",
        created_at: new Date().toISOString(),
      };
      offlineQueue.push({ from_phc_id, to_phc_id, medicine, quantity, mockManifest });
      localStorage.setItem("offline_transfers", JSON.stringify(offlineQueue));
      // Dispatch storage event locally so list updates in active window
      window.dispatchEvent(new Event("storage"));
      return Promise.resolve(mockManifest);
    }
    return client
      .post<{ status: string; manifest: Transfer }>("/api/transfers", {
        from_phc_id,
        to_phc_id,
        medicine,
        quantity,
      })
      .then((r) => r.data.manifest);
  },
  triggerCrisis: (target_type: string, target_name: string, crisis_type: string) =>
    client
      .post<{ status: string; active_crises: ActiveCrisis[] }>("/api/crisis/trigger", {
        target_type,
        target_name,
        crisis_type,
      })
      .then((r) => r.data),
  resetCrisis: () => client.post<{ status: string; message: string }>("/api/crisis/reset").then((r) => r.data),
  activeCrises: () => client.get<ActiveCrisis[]>("/api/crisis/active").then((r) => r.data),
  explainTransfer: (fromId: string, toId: string, medicine: string, lang: string) =>
    client
      .get<{ explanation: string }>(
        `/api/redistribution/${fromId}/${toId}/${encodeURIComponent(medicine)}/explain`,
        { params: { lang } }
      )
      .then((r) => r.data.explanation),
  capacityRedistribution: (state?: string) =>
    client
      .get<CapacityRecommendations>("/api/redistribution/capacity", { params: { state } })
      .then((r) => r.data),
  anomalies: (state?: string) =>
    client.get<ConsumptionAnomaly[]>("/api/anomalies", { params: { state } }).then((r) => r.data),
  explainAnomaly: (phcId: string, lang: string) =>
    client
      .get<ConsumptionAnomaly>(`/api/anomalies/${phcId}/explain`, { params: { lang } })
      .then((r) => r.data),
  auditLog: (limit = 100) =>
    client.get<AuditEvent[]>("/api/audit", { params: { limit } }).then((r) => r.data),
  downloadFhir: (transferId: string) =>
    client.get<object>(`/api/fhir/transfer/${transferId}`).then((r) => {
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fhir-supply-request-${transferId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }),
};

export const syncOfflineTransfers = async () => {
  const offlineQueue = JSON.parse(localStorage.getItem("offline_transfers") || "[]");
  if (offlineQueue.length === 0) return;
  console.log(`[localSync] Synchronizing ${offlineQueue.length} offline transfers...`);
  
  const remaining = [];
  for (const item of offlineQueue) {
    try {
      await client.post("/api/transfers", {
        from_phc_id: item.from_phc_id,
        to_phc_id: item.to_phc_id,
        medicine: item.medicine,
        quantity: item.quantity,
      });
    } catch (err) {
      console.error("[localSync] Failed to sync offline transfer", err);
      if (axios.isAxiosError(err) && (!err.response || err.response.status >= 500)) {
        remaining.push(item);
      }
    }
  }
  localStorage.setItem("offline_transfers", JSON.stringify(remaining));
  window.dispatchEvent(new Event("storage"));
};

if (typeof window !== "undefined") {
  window.addEventListener("online", syncOfflineTransfers);
}
