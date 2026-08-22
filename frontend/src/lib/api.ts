import axios from "axios";
import type {
  PHC,
  PHCDetail,
  Medicine,
  Forecast,
  RedistributionRec,
  NationalFederatedPrior,
  BricsSharedPrior,
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
};
