export interface Staff {
  role: string;
  sanctioned: number;
}

export interface PHC {
  id: string;
  name: string;
  state: string;
  district: string;
  lat: number;
  lon: number;
  beds_total: number;
  staff: Staff[];
  beds_occupied?: number;
  attendance_pct?: number;
}

export interface PHCDetail extends PHC {
  dates: string[];
  bed_occupancy: number[];
  staff_attendance: number[];
  stock: Record<string, { unit: string; category: string; capacity: number; reorder_level: number; levels: number[] }>;
}

export interface Medicine {
  name: string;
  unit: string;
  category: string;
  seasonal: string | null;
  // Optional tier metadata provided by the backend reference data
  tier?: number;
  tier_title?: string;
  tier_badge?: string;
  tier_color?: string;
  tier_description?: string;
}

export type Risk = "low" | "warning" | "critical";

export interface Forecast {
  phc_id: string;
  medicine: string;
  unit: string;
  current_level: number;
  capacity: number;
  reorder_level: number;
  daily_depletion_rate: number;
  days_to_stockout: number | null;
  risk: Risk;
  projection: number[];
  phc_name?: string;
  state?: string;
  district?: string;
  surge_detected?: boolean;
  baseline_rate?: number;
  forecast_method?: string;
  projected_levels?: number[];
  forecast_lower?: number[];
  forecast_upper?: number[];
  forecasted_daily_demand?: number[];
  temperature?: number;
  cold_chain_alert?: boolean;
  // Present only on forecasts returned from a weather scenario (?weather_adjusted=true).
  weather_adjusted?: boolean;
  weather_factor?: number;
  baseline_days_to_stockout?: number | null;
  baseline_risk?: Risk;
}

export interface RedistributionRec {
  medicine: string;
  unit: string;
  from_phc_id: string;
  from_phc_name: string;
  from_state: string;
  from_district: string;
  to_phc_id: string;
  to_phc_name: string;
  to_state: string;
  to_district: string;
  quantity: number;
  distance_km: number;
  cross_state: boolean;
  urgency: Risk;
  explanation?: string | null;
}

export interface StateNodeSummary {
  node: string;
  facility_count: number;
  category_depletion_rates: Record<string, number>;
  critical_alerts: number;
  warning_alerts: number;
}

export interface NationalFederatedPrior {
  participating_nodes: string[];
  total_facilities: number;
  category_depletion_prior: Record<string, number>;
  node_summaries: StateNodeSummary[];
  contributing_nodes_count: number;
  model_confidence_score: number;
}

export interface BricsSharedPrior {
  nodes: StateNodeSummary[];
  global_category_depletion_prior: Record<string, number>;
  note: string;
  contributing_nodes_count: number;
  model_confidence_score: number;
}

export interface TransferDispatch {
  dispatch_id: string;
  provider: string;
  simulated: boolean;
  eta_minutes: number;
  dispatched_at: string;
}

export interface Transfer {
  id: string;
  medicine: string;
  unit: string;
  from_phc_id: string;
  from_phc_name: string;
  from_state: string;
  from_district: string;
  to_phc_id: string;
  to_phc_name: string;
  to_state: string;
  to_district: string;
  quantity: number;
  status: string;
  created_at: string;
  requested_by?: string | null;
  // Phase 5 — autonomous dispatch for routine, low-risk transfers. See
  // services/dispatch.py: auto_dispatched is only ever true for a
  // simulated ground courier today, never a live logistics integration.
  auto_dispatched?: boolean;
  dispatch?: TransferDispatch | null;
  auto_dispatch_declined_reason?: string | null;
}

export interface ActiveCrisis {
  target_type: string;
  target_name: string;
  crisis_type: string;
}

export interface AnomalyContribution {
  medicine: string;
  window_rate: number;
  baseline_rate: number;
  unit: string;
  ratio: number;
}

export interface ConsumptionAnomaly {
  phc_id: string;
  phc_name: string;
  district: string;
  state: string;
  direction: "over_consumption" | "under_reporting";
  severity: "high" | "medium";
  z_score: number;
  consumption_change_pct: number;
  footfall_change_pct: number;
  window_days: number;
  avg_daily_visits: number;
  baseline_daily_visits: number;
  flagged_medicines: string[];
  detail: AnomalyContribution[];
  headline: string;
  flagged?: boolean;
  explanation?: string | null;
}

export interface BedRec {
  resource: "beds";
  from_phc_id: string;
  from_phc_name: string;
  from_state: string;
  from_district: string;
  to_phc_id: string;
  to_phc_name: string;
  to_state: string;
  to_district: string;
  distance_km: number;
  cross_state: boolean;
  patients: number;
  overflow_utilisation_pct: number;
  severity: "high" | "medium";
}

export interface StaffRec {
  resource: "staff";
  from_phc_id: string;
  from_phc_name: string;
  from_state: string;
  from_district: string;
  to_phc_id: string;
  to_phc_name: string;
  to_state: string;
  to_district: string;
  distance_km: number;
  cross_state: boolean;
  staff_fte: number;
  recipient_attendance_pct: number;
  severity: "high" | "medium";
}

export interface CapacityRecommendations {
  beds: BedRec[];
  staff: StaffRec[];
}

export interface AuditEvent {
  ts: string;
  kind: string;
  summary: string;
}

export interface ActingUser {
  user_id: string;
  label: string;
  role: string;
  authorized_phc_ids: string[];
  authorized_states: string[];
}

export type Lang = "en" | "hi" | "mr" | "ta";

// Public Transparency Portal — every field here is a state/national
// aggregate from /api/public/*, never a PHC-level identifier.
export interface PublicStateSummary {
  state: string;
  facility_count: number;
  avg_risk_score: number;
  critical_facility_count: number;
  population_served: number;
  critical_risk_per_100k: number;
  transfers_executed_30d: number;
  stockouts_prevented_30d: number;
  last_updated: string;
}

export interface PublicNationalSummary {
  states_covered: number;
  total_facilities_monitored: number;
  population_served: number;
  avg_depletion_rate_by_category: Record<string, number>;
  critical_facility_count: number;
  avg_risk_score: number;
  critical_risk_per_100k: number;
  transfers_executed_30d: number;
  stockouts_prevented_30d: number;
  last_updated: string;
}

// ---- Real-world data (backend /api/live/*). Everything here comes from public
// APIs at request time, except NetworkFacility, which is the synthetic demo network.

export type SignalLevel = "normal" | "elevated" | "high";

export interface WeatherSignal {
  id: "flood" | "vector" | "heat";
  label: string;
  level: SignalLevel;
  reason: string;
  suggested_crisis: string | null;
}

export interface WeatherReading {
  lat: number;
  lon: number;
  current: {
    temperature_c: number | null;
    apparent_temperature_c: number | null;
    humidity_pct: number | null;
    precipitation_mm: number | null;
    wind_kmh: number | null;
    observed_at: string | null;
  };
  daily: { date: string; rain_mm: number | null; temp_max_c: number | null; temp_min_c: number | null }[];
  rain_7d_mm: number;
  signals: WeatherSignal[];
  level: SignalLevel;
}

export interface StateWeather extends WeatherReading {
  state: string;
}

export interface StateWeatherResponse {
  source: string;
  fetched_at: string;
  stale: boolean;
  states: StateWeather[];
}

export interface PlaceSnapshot {
  source: string;
  fetched_at: string;
  stale: boolean;
  point: { lat: number; lon: number };
  weather: WeatherReading;
  air: { us_aqi: number | null; pm2_5: number | null; pm10: number | null; category: string | null; observed_at: string | null } | null;
}

export interface GeocodeResult {
  name: string;
  admin1: string | null;
  admin2: string | null;
  country: string | null;
  lat: number;
  lon: number;
  population: number | null;
}

export interface BenchmarkIndicator {
  id: string;
  label: string;
  unit: string;
  higher_is_better: boolean;
}

export interface BenchmarkCatalog {
  source: string;
  indicators: BenchmarkIndicator[];
  countries: { iso3: string; name: string }[];
}

export interface BenchmarkCountry {
  iso3: string;
  name: string;
  series: { year: number; value: number }[];
  latest: { year: number; value: number } | null;
}

export interface BenchmarkResponse {
  source: string;
  source_url: string;
  fetched_at: string;
  stale: boolean;
  indicator: BenchmarkIndicator;
  countries: BenchmarkCountry[];
}

export interface OsmFacility {
  osm_id: string;
  name: string;
  kind: string;
  operator: string | null;
  lat: number;
  lon: number;
  distance_km: number;
  osm_url: string;
}

export interface OsmFacilitiesResponse {
  source: string;
  fetched_at: string;
  stale: boolean;
  center: { lat: number; lon: number };
  radius_km: number;
  count: number;
  facilities: OsmFacility[];
}

export interface NetworkFacility {
  id: string;
  name: string;
  state: string;
  district: string;
  facility_type: string;
  lat: number;
  lon: number;
  distance_km: number;
  risk: Risk;
  critical_items: number;
  warning_items: number;
  soonest_stockout_days: number | null;
  synthetic: true;
}

export interface NetworkFacilitiesResponse {
  source: string;
  center: { lat: number; lon: number };
  count: number;
  facilities: NetworkFacility[];
}

export interface WeatherImpactItem {
  phc_id: string;
  phc_name: string;
  state: string;
  district: string;
  medicine: string;
  unit: string;
  current_level: number;
  factor: number;
  causes: { signal: string; level: string; label: string }[];
  days_before: number | null;
  days_after: number | null;
  risk_before: Risk;
  risk_after: Risk;
}

export interface WeatherImpact {
  source: string;
  fetched_at: string;
  stale: boolean;
  intensity: number;
  disclaimer: string;
  assumptions: { signal: string; medicine: string; elevated: number; high: number; why: string }[];
  states: { state: string; level: SignalLevel; active_signals: string[]; medicines_affected: string[]; pairs_affected: number; pairs_worsened: number; new_critical: number }[];
  totals: { pairs_affected: number; pairs_worsened: number; new_critical: number; cold_chain_items_exposed_to_heat: number };
  items: WeatherImpactItem[];
}

export interface AppNotification {
  id: number;
  ts: string;
  kind: string;
  title: string;
  body: string;
  state: string | null;
  signal: string | null;
  level: string | null;
  delivery: string | null;
  read: boolean;
}

export interface NotificationConfig {
  polling_enabled: boolean;
  poll_minutes: number;
  webhook_configured: boolean;
}

export interface FacilityCountBenchmarkRow {
  state: string;
  official: { sub_centres: number | null; phcs: number | null; chcs: number | null };
  network_facility_count: number | null;
  network_vs_official_phcs_pct: number | null;
}

export interface FacilityCountBenchmark {
  source: string;
  source_url: string;
  as_of: string;
  fetched_at: string;
  disclaimer: string;
  stale: boolean;
  states: FacilityCountBenchmarkRow[];
}
