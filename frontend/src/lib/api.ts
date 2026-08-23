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
  redistribution: (state?: string) =>
    client.get<RedistributionRec[]>("/api/redistribution", { params: { state } }).then((r) => r.data),
  federatedNational: () => client.get<NationalFederatedPrior>("/api/federated/national").then((r) => r.data),
  federatedBrics: () => client.get<BricsSharedPrior>("/api/federated/brics").then((r) => r.data),
  chat: (query: string, lang: string, state?: string) =>
    client.post<{ reply: string }>("/api/assistant/chat", { query, lang, state }).then((r) => r.data.reply),
  listTransfers: () => client.get<Transfer[]>("/api/transfers").then((r) => r.data),
  executeTransfer: (from_phc_id: string, to_phc_id: string, medicine: string, quantity: number) =>
    client
      .post<{ status: string; manifest: Transfer }>("/api/transfers", {
        from_phc_id,
        to_phc_id,
        medicine,
        quantity,
      })
      .then((r) => r.data.manifest),
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
};
