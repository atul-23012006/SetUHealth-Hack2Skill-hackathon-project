// IndiaMap — Leaflet-powered live PHC risk map with redistribution transfer arrows.
// Renders colour-coded CircleMarkers per PHC (green/amber/red by risk level) and
// animated dashed Polyline arrows for redistribution recommendations.
import { MapContainer, TileLayer, CircleMarker, Tooltip, Polyline } from "react-leaflet";
import "leaflet/dist/leaflet.css";
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

interface Props {
  phcs: PHC[];
  riskByPhc: Record<string, Risk>;
  recs?: RedistributionRec[];
}

export default function IndiaMap({ phcs, riskByPhc, recs = [] }: Props) {
  const navigate = useNavigate();

  // Build a quick O(1) lookup map for lat/lon
  const phcById = new Map(phcs.map((p) => [p.id, p]));

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

      {/* PHC dots */}
      {phcs.map((p) => {
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
            <Tooltip direction="top">
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
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
