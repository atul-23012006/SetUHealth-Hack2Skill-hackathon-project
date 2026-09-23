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
  ActingUser,
  PublicStateSummary,
  PublicNationalSummary,
  StateWeatherResponse,
  WeatherImpact,
  AppNotification,
  NotificationConfig,
  PlaceSnapshot,
  GeocodeResult,
  BenchmarkCatalog,
  BenchmarkResponse,
  OsmFacilitiesResponse,
  NetworkFacilitiesResponse,
  FacilityCountBenchmark,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const ACTING_USER_KEY = "setuhealth_acting_user_id";
// Session token (token auth mode). Dispatched when the server says it is no longer valid.
export const TOKEN_KEY = "setuhealth_token";
export const SIGNED_OUT_EVENT = "setuhealth:signed-out";

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session just won't survive a reload */
  }
}
// Offline transfers the server refused on sync (see syncOfflineTransfers), shown by Layout.
export const REJECTED_KEY = "offline_transfers_rejected";

const client = axios.create({ baseURL: BASE_URL });

// Every request carries whichever demo identity the operator picked in the
// header's "acting as" switcher (see lib/AuthContext.tsx), so the backend's
// transfer-authorization check has someone to check against. Read fresh from
// localStorage on every request rather than once at module load, since the
// user can switch identity mid-session without a page reload.
// Identity headers for every request. Shared by axios (below) and fetch (the
// streaming chat, since axios cannot stream in the browser).
export function authHeaders(): Record<string, string> {
  // A session token wins; the demo identity header is only for demo mode.
  const token = readToken();
  if (token) return { Authorization: `Bearer ${token}` };
  try {
    const userId = localStorage.getItem(ACTING_USER_KEY);
    return userId ? { "X-User-Id": userId } : {};
  } catch {
    return {}; // storage unavailable (private browsing, disabled storage): proceed unauthenticated
  }
}

// An expired or revoked session: forget it and tell the app to show the sign-in page.
function handleUnauthorized() {
  if (readToken()) {
    storeToken(null);
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
}

client.interceptors.request.use((config) => {
  try {
    for (const [name, value] of Object.entries(authHeaders())) {
      // config.headers is an AxiosHeaders instance here, not a plain object —
      // a bracket/property assignment silently sets a JS property that axios's
      // own header serialization never reads, so the header never actually
      // reaches the network. .set() is the API that's guaranteed to work.
      config.headers.set(name, value);
    }
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — proceed unauthenticated
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) handleUnauthorized();
    return Promise.reject(error);
  },
);

export const api = {
  states: () => client.get<Record<string, string[]>>("/api/states").then((r) => r.data),
  phcs: (state?: string, district?: string) =>
    client.get<PHC[]>("/api/phcs", { params: { state, district } }).then((r) => r.data),
  phc: (id: string) => client.get<PHCDetail>(`/api/phcs/${id}`).then((r) => r.data),
  medicines: () => client.get<Medicine[]>("/api/medicines").then((r) => r.data),
  // `scenario` overlays the real weather outlook as a demand scenario (see backend weather_impact.py).
  alerts: (state?: string, limit = 20, scenario?: { intensity: number }) =>
    client
      .get<Forecast[]>("/api/alerts", {
        params: { state, limit, ...(scenario ? { weather_adjusted: true, intensity: scenario.intensity } : {}) },
      })
      .then((r) => r.data),
  explainAlert: (phcId: string, medicine: string, lang: string) =>
    client
      .get<{ explanation: string }>(`/api/alerts/${phcId}/${encodeURIComponent(medicine)}/explain`, {
        params: { lang },
      })
      .then((r) => r.data.explanation),
  forecastAll: (state?: string) => client.get<Forecast[]>("/api/forecast", { params: { state } }).then((r) => r.data),
  redistribution: (state?: string, explain?: boolean, lang?: string, scenario?: { intensity: number }) =>
    client
      .get<RedistributionRec[]>("/api/redistribution", {
        params: { state, explain, lang, ...(scenario ? { weather_adjusted: true, intensity: scenario.intensity } : {}) },
      })
      .then((r) => r.data),

  federatedNational: () => client.get<NationalFederatedPrior>("/api/federated/national").then((r) => r.data),
  federatedBrics: () => client.get<BricsSharedPrior>("/api/federated/brics").then((r) => r.data),
  chat: (query: string, lang: string, state?: string) =>
    client.post<{ reply: string }>("/api/assistant/chat", { query, lang, state }).then((r) => r.data.reply),
  // Streams the reply as server-sent events, calling onDelta for each chunk.
  chatStream: async (
    query: string,
    lang: string,
    state: string | undefined,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}/api/assistant/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query, lang, state }),
      signal,
    });
    if (res.status === 401) handleUnauthorized();
    if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!raw.startsWith("data: ")) continue;
        const event = JSON.parse(raw.slice(6));
        if (event.error) throw new Error(event.error);
        if (event.delta) onDelta(event.delta);
        if (event.done) return;
      }
    }
  },
  listTransfers: () => client.get<Transfer[]>("/api/transfers").then((r) => r.data),
  executeTransfer: (
    from_phc_id: string,
    to_phc_id: string,
    medicine: string,
    quantity: number,
    // Lets the system auto-dispatch a simulated courier for routine,
    // low-risk transfers instead of completing with no logistics step at
    // all — see services/transfers.py's eligibility gate. Large,
    // cross-state, or destination-critical transfers ignore this and
    // execute exactly as before regardless.
    autoExecute = true
  ) => {
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
      // Best-effort fire-and-forget trace: if the browser closes and never
      // reopens, storage is cleared, or the user switches devices before the
      // "online" event fires to actually sync this, the local queue entry is
      // gone with zero server-side trace. sendBeacon can't retry or carry
      // headers, but it gives the server a breadcrumb even in that case —
      // it does NOT apply the transfer.
      try {
        const beaconUrl = `${BASE_URL}/api/transfers/pending`;
        const payload = new Blob(
          [JSON.stringify({ from_phc_id, to_phc_id, medicine, quantity })],
          { type: "application/json" }
        );
        navigator.sendBeacon?.(beaconUrl, payload);
      } catch {
        // best-effort only — never block the offline queue on this
      }
      return Promise.resolve(mockManifest);
    }
    return client
      .post<{ status: string; manifest: Transfer }>("/api/transfers", {
        from_phc_id,
        to_phc_id,
        medicine,
        quantity,
        auto_execute: autoExecute,
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
  anomalyNetworkStatus: () =>
    client.get<{ available: boolean; systemic_shift: boolean; drift_z?: number }>("/api/anomalies/network-status").then((r) => r.data),
  auditLog: (limit = 100) =>
    client.get<AuditEvent[]>("/api/audit", { params: { limit } }).then((r) => r.data),
  authConfig: () => client.get<{ mode: "demo" | "token" }>("/api/auth/config").then((r) => r.data),
  login: (userId: string, password: string) =>
    client
      .post<{ access_token: string; expires_in: number; user: ActingUser }>("/api/auth/login", { user_id: userId, password })
      .then((r) => r.data),
  me: () => client.get<{ user: ActingUser | null }>("/api/auth/me").then((r) => r.data.user),
  listUsers: () => client.get<ActingUser[]>("/api/auth/users").then((r) => r.data),
  publicStates: () => client.get<PublicStateSummary[]>("/api/public/states").then((r) => r.data),
  publicNational: () => client.get<PublicNationalSummary>("/api/public/national").then((r) => r.data),
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

  // ---- Real-world data (public APIs proxied and cached by the backend)
  notifications: (unreadOnly = false, limit = 30) =>
    client
      .get<{ items: AppNotification[]; unread: number }>("/api/notifications", { params: { unread_only: unreadOnly, limit } })
      .then((r) => r.data),
  markNotificationsRead: (ids?: number[]) =>
    client.post<{ marked: number; unread: number }>("/api/notifications/read", { ids }).then((r) => r.data),
  checkSignalsNow: () =>
    client
      .post<{ created: { id: number; title: string }[]; unread: number }>("/api/notifications/check")
      .then((r) => r.data),
  notificationConfig: () => client.get<NotificationConfig>("/api/notifications/config").then((r) => r.data),
  liveImpact: (intensity: number, state?: string) =>
    client.get<WeatherImpact>("/api/live/impact", { params: { intensity, state } }).then((r) => r.data),
  liveFacilityCountBenchmarks: (states?: string[]) =>
    client
      .get<FacilityCountBenchmark>("/api/live/facility-benchmarks", { params: { states: states?.join(",") } })
      .then((r) => r.data),
  liveStateWeather: () => client.get<StateWeatherResponse>("/api/live/weather/states").then((r) => r.data),
  liveWeather: (lat: number, lon: number) =>
    client.get<PlaceSnapshot>("/api/live/weather", { params: { lat, lon } }).then((r) => r.data),
  liveGeocode: (q: string) =>
    client
      .get<{ results: GeocodeResult[] }>("/api/live/geocode", { params: { q } })
      .then((r) => r.data.results),
  liveBenchmarkCatalog: () => client.get<BenchmarkCatalog>("/api/live/benchmarks/catalog").then((r) => r.data),
  liveBenchmarks: (indicator: string, countries?: string[]) =>
    client
      .get<BenchmarkResponse>("/api/live/benchmarks", {
        params: { indicator, countries: countries?.join(",") },
      })
      .then((r) => r.data),
  liveOsmFacilities: (lat: number, lon: number, radiusKm: number) =>
    client
      .get<OsmFacilitiesResponse>("/api/live/facilities/osm", { params: { lat, lon, radius_km: radiusKm } })
      .then((r) => r.data),
  liveNetworkFacilities: (lat: number, lon: number, limit = 12) =>
    client
      .get<NetworkFacilitiesResponse>("/api/live/facilities/network", { params: { lat, lon, limit } })
      .then((r) => r.data),
};

export const syncOfflineTransfers = async () => {
  const offlineQueue = JSON.parse(localStorage.getItem("offline_transfers") || "[]");
  if (offlineQueue.length === 0) return;
  console.log(`[localSync] Synchronizing ${offlineQueue.length} offline transfers...`);
  
  const remaining = [];
  const rejected: any[] = [];
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
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      // Retry later: no response (still offline), server errors, rate limiting,
      // and 401/403 (the operator may simply not have picked an identity yet;
      // dropping it would silently lose the transfer).
      const retryable = status === undefined || status >= 500 || status === 401 || status === 403 || status === 408 || status === 429;
      if (retryable) {
        remaining.push(item);
      } else {
        // The server understood and refused it (e.g. quantity above the donor's
        // stock). Keep the reason so the UI can tell the operator instead of
        // the transfer vanishing.
        const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
        rejected.push({ ...item, rejected_reason: typeof detail === "string" ? detail : `HTTP ${status}` });
      }
    }
  }
  localStorage.setItem("offline_transfers", JSON.stringify(remaining));
  if (rejected.length > 0) {
    const previous = JSON.parse(localStorage.getItem(REJECTED_KEY) || "[]");
    localStorage.setItem(REJECTED_KEY, JSON.stringify([...previous, ...rejected]));
  }
  window.dispatchEvent(new Event("storage"));
};

if (typeof window !== "undefined") {
  window.addEventListener("online", syncOfflineTransfers);
}
