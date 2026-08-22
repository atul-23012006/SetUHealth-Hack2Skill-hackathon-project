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
}

export interface BricsSharedPrior {
  nodes: StateNodeSummary[];
  global_category_depletion_prior: Record<string, number>;
  note: string;
}

export type Lang = "en" | "hi" | "mr" | "ta";
