// IndiaMap — Leaflet-powered live PHC risk map with redistribution transfer arrows.
// Renders colour-coded CircleMarkers per PHC (green/amber/red by risk level) and
// animated dashed Polyline arrows for redistribution recommendations. Above
// CLUSTER_THRESHOLD facilities, markers are grouped into risk-coloured clusters
// so the national view stays legible at low zoom.
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip, Polyline } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
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
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${riskColor[risk]};border:${borderWidth}px solid white;box-shadow:0 0 0 1px rgba(0,0,0,0.15);"></div>`,
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
  phcs: PHC[];
  riskByPhc: Record<string, Risk>;
  recs?: RedistributionRec[];
}

export default function IndiaMap({ phcs, riskByPhc, recs = [] }: Props) {
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
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />

      {/* Transfer arrows — dashed Polylines from donor to recipient */}
      {recs.map((r, i) => {
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
              opacity: 0.75,
              dashArray: "7 5",
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

      {/* PHC dots — clustered above CLUSTER_THRESHOLD, plain CircleMarkers below it */}
      {shouldCluster ? (
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
      )}
    </MapContainer>
  );
}
