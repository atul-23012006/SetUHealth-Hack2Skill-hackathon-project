import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { PHC, Risk } from "../lib/types";
import { useNavigate } from "react-router-dom";

const riskColor: Record<Risk, string> = {
  critical: "#e11d48",
  warning: "#d97706",
  low: "#059669",
};

interface Props {
  phcs: PHC[];
  riskByPhc: Record<string, Risk>;
}

export default function IndiaMap({ phcs, riskByPhc }: Props) {
  const navigate = useNavigate();

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
      {phcs.map((p) => {
        const risk = riskByPhc[p.id] ?? "low";
        return (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={risk === "critical" ? 7 : risk === "warning" ? 5.5 : 4}
            pathOptions={{ color: riskColor[risk], fillColor: riskColor[risk], fillOpacity: 0.75, weight: 1 }}
            eventHandlers={{ click: () => navigate(`/states/${encodeURIComponent(p.state)}`) }}
          >
            <Tooltip direction="top">
              <div className="text-xs">
                <div className="font-semibold">{p.name}</div>
                <div>{p.district}, {p.state}</div>
              </div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
