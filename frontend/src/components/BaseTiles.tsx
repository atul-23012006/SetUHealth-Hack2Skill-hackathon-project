import { TileLayer } from "react-leaflet";

// Esri Light Gray Canvas: a key-free basemap designed to sit under data
// overlays. (The previous CARTO tiles now return an "API KEY REQUIRED"
// watermark.) Place labels are a separate transparent layer on top.
export default function BaseTiles() {
  return (
    <>
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
        maxNativeZoom={16}
      />
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={16}
        zIndex={2}
      />
    </>
  );
}
