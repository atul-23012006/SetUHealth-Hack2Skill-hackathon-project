// IndiaMap — Leaflet-powered live PHC risk map with redistribution transfer arrows.
// Renders colour-coded CircleMarkers per PHC (green/amber/red by risk level) and
// animated dashed Polyline arrows for redistribution recommendations. Above
// CLUSTER_THRESHOLD facilities, markers are grouped into risk-coloured clusters
// so the national view stays legible at low zoom.
import { MapContainer, CircleMarker, Marker, Tooltip, Polyline } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import BaseTiles from "./BaseTiles";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import type { PHC, Risk, RedistributionRec } from "../lib/types";
import { useNavigate } from "react-router-dom";

const riskColor: Record<Risk, string> = {
  critical: "#e11d48",
  warning: "#d97706",
  low: "#059669",
};

const urgencyArrowColor: Record<Risk, string> = {
  critical: "#f43f5e",
  warning: "#f59e0b",
  low: "#10b981",
};

const CLUSTER_THRESHOLD = 40;

// Above the threshold, individual PHC dots become divIcon Markers (leaflet.markercluster
// only clusters L.Marker instances, not vector layers like CircleMarker), sized to
// roughly match the CircleMarker radii used in the unclustered view below.
const markerDiameter: Record<Risk, number> = { critical: 14, warning: 11, low: 8 };

function makeRiskIcon(risk: Risk): L.DivIcon {
  const size = markerDiameter[risk];
  const borderWidth = risk === "critical" ? 2 : 1;
  return L.divIcon({
    className: "",
    html: `<div class="${risk === "critical" ? "risk-pulse" : ""}" style="width:${size}px;height:${size}px;border-radius:50%;background:${riskColor[risk]};border:${borderWidth}px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const riskIcons: Record<Risk, L.DivIcon> = {
  critical: makeRiskIcon("critical"),
  warning: makeRiskIcon("warning"),
  low: makeRiskIcon("low"),
};

function dominantRisk(risks: Risk[]): Risk {
  if (risks.includes("critical")) return "critical";
  if (risks.includes("warning")) return "warning";
  return "low";
}

// Buckets a 0-100 public avg_risk_score into the same three risk colours
// used everywhere else, so the public map reads consistently with the
// officer console's palette even though the underlying metric is different
// (a state-level composite, not a single PHC's forecast risk).
export function scoreToRisk(score: number): Risk {
  if (score >= 60) return "critical";
  if (score >= 25) return "warning";
  return "low";
}

export interface StateRiskMarker {
  state: string;
  lat: number;
  lon: number;
  riskScore: number;
  facilityCount: number;
}

function createClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const risks = cluster.getAllChildMarkers().map((m: L.Marker) => (m.options.alt as Risk) ?? "low");
  const count = cluster.getChildCount();
  const color = riskColor[dominantRisk(risks)];
  const size = count >= 50 ? 44 : count >= 10 ? 38 : 32;
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid white;box-shadow:0 1px 6px rgba(15,23,42,0.35);">${count}</div>`,
    iconSize: L.point(size, size, true),
  });
}

interface Props {
  phcs?: PHC[];
  riskByPhc?: Record<string, Risk>;
  recs?: RedistributionRec[];
  // Public Transparency Portal mode: renders one marker per state coloured
  // by its aggregate risk score instead of per-PHC dots, never shows
  // redistribution arrows, and routes clicks through onStateClick instead
  // of the officer console's /states/:state drill-down.
  readOnly?: boolean;
  stateMarkers?: StateRiskMarker[];
  onStateClick?: (state: string) => void;
}

export default function IndiaMap({
  phcs = [],
  riskByPhc = {},
  recs = [],
  readOnly = false,
  stateMarkers = [],
  onStateClick,
}: Props) {
  const navigate = useNavigate();

  // Build a quick O(1) lookup map for lat/lon
  const phcById = new Map(phcs.map((p) => [p.id, p]));
  const shouldCluster = phcs.length > CLUSTER_THRESHOLD;

  const tooltipContent = (p: PHC, risk: Risk) => (
    <div className="text-xs space-y-0.5">
      <div className="font-semibold">{p.name}</div>
      <div className="text-slate-500">{p.district}, {p.state}</div>
      <div
        className={`font-bold uppercase text-[10px] ${
          risk === "critical"
            ? "text-rose-600"
            : risk === "warning"
            ? "text-amber-600"
            : "text-emerald-600"
        }`}
      >
        {risk}
      </div>
    </div>
  );

  return (
    <MapContainer
      center={[22.9734, 78.6569]}
      zoom={4.4}
      scrollWheelZoom={false}
      className="h-full w-full rounded-lg"
    >
      <BaseTiles />

      {/* Transfer arrows — dashed Polylines from donor to recipient (never shown in read-only/public mode) */}
      {!readOnly && recs.map((r, i) => {
        const fromPhc = phcById.get(r.from_phc_id);
        const toPhc = phcById.get(r.to_phc_id);
        if (!fromPhc || !toPhc) return null;
        const color = urgencyArrowColor[r.urgency] ?? "#6366f1";
        return (
          <Polyline
            key={`rec-${i}`}
            positions={[
              [fromPhc.lat, fromPhc.lon],
              [toPhc.lat, toPhc.lon],
            ]}
            pathOptions={{
              color,
              weight: r.urgency === "critical" ? 2.5 : 1.8,
              opacity: 0.85,
              dashArray: "7 5",
              className: "transfer-arrow",
            }}
          >
            <Tooltip sticky>
              <div className="text-xs space-y-0.5">
                <div className="font-bold">{r.quantity} {r.unit} · {r.medicine}</div>
                <div className="text-slate-500">{r.from_phc_name} → {r.to_phc_name}</div>
                <div className="text-slate-400">{r.distance_km} km {r.cross_state ? "· cross-state" : ""}</div>
              </div>
            </Tooltip>
          </Polyline>
        );
      })}

      {/* Public portal mode — one CircleMarker per state, sized by facility count, coloured by aggregate risk score */}
      {readOnly &&
        stateMarkers.map((s) => {
          const risk = scoreToRisk(s.riskScore);
          return (
            <CircleMarker
              key={s.state}
              center={[s.lat, s.lon]}
              radius={10 + Math.min(10, Math.sqrt(s.facilityCount))}
              pathOptions={{
                color: riskColor[risk],
                fillColor: riskColor[risk],
                fillOpacity: 0.65,
                weight: 2,
              }}
              eventHandlers={{
                click: () => onStateClick?.(s.state),
              }}
            >
              <Tooltip direction="top">
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold">{s.state}</div>
                  <div className="text-slate-500">{s.facilityCount} facilities monitored</div>
                  <div
                    className={`font-bold uppercase text-[10px] ${
                      risk === "critical" ? "text-rose-600" : risk === "warning" ? "text-amber-600" : "text-emerald-600"
                    }`}
                  >
                    Risk score: {s.riskScore}
                  </div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}

      {/* PHC dots — clustered above CLUSTER_THRESHOLD, plain CircleMarkers below it */}
      {!readOnly && (shouldCluster ? (
        <MarkerClusterGroup
          iconCreateFunction={createClusterIcon}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
        >
          {phcs.map((p) => {
            const risk = riskByPhc[p.id] ?? "low";
            return (
              <Marker
                key={p.id}
                position={[p.lat, p.lon]}
                icon={riskIcons[risk]}
                alt={risk}
                eventHandlers={{
                  click: () => navigate(`/states/${encodeURIComponent(p.state)}`),
                }}
              >
                <Tooltip direction="top">{tooltipContent(p, risk)}</Tooltip>
              </Marker>
            );
          })}
        </MarkerClusterGroup>
      ) : (
        phcs.map((p) => {
          const risk = riskByPhc[p.id] ?? "low";
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lon]}
              radius={risk === "critical" ? 7 : risk === "warning" ? 5.5 : 4}
              pathOptions={{
                color: riskColor[risk],
                fillColor: riskColor[risk],
                fillOpacity: 0.8,
                weight: risk === "critical" ? 2 : 1,
              }}
              eventHandlers={{
                click: () => navigate(`/states/${encodeURIComponent(p.state)}`),
              }}
            >
              <Tooltip direction="top">{tooltipContent(p, risk)}</Tooltip>
            </CircleMarker>
          );
        })
      ))}
    </MapContainer>
  );
}
