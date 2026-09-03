import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../api/client";
import { PageHeader } from "../components/ui";
import { trailsFromPoints } from "../lib/trails";
import { osmRasterStyle } from "../lib/maps";

export function MapPage() {
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["map"],
    queryFn: () =>
      api<{
        data: {
          customers: Array<{ id: string; lat: string | null; lng: string | null; code: string }>;
          connections: Array<{ id: string; lat: string | null; lng: string | null; code: string; status: string }>;
          readings: Array<{ id: string; lat: string | null; lng: string | null; anomaly: string; requiresReview: boolean }>;
          collectionPoints?: Array<{ id: string; lat: string | null; lng: string | null; routeId: string; capturedAt?: string | null }>;
        };
      }>("/map/features"),
  });

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: osmRasterStyle(),
      center: [-57.635, -25.3],
      zoom: 11,
    });
    const pts = [
      ...(q.data?.data.customers ?? []).map((p) => ({ ...p, color: "#0f4c5c", label: p.code })),
      ...(q.data?.data.connections ?? []).map((p) => ({ ...p, color: "#1b6b93", label: p.code })),
      ...(q.data?.data.readings ?? []).map((p) => ({
        ...p,
        color: p.requiresReview ? "#b45309" : "#15803d",
        label: p.anomaly === "NONE" ? "Lectura" : p.anomaly,
      })),
    ];
    const trails = trailsFromPoints(q.data?.data.collectionPoints ?? []);
    map.on("load", () => {
      trails.forEach((line, i) => {
        const id = `collector-trail-${i}`;
        map.addSource(id, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } },
        });
        map.addLayer({
          id,
          type: "line",
          source: id,
          paint: { "line-color": "#7c3aed", "line-width": 4, "line-opacity": 0.9 },
        });
      });
      for (const p of pts) {
        if (!p.lat || !p.lng) continue;
        new maplibregl.Marker({ color: p.color }).setLngLat([Number(p.lng), Number(p.lat)]).setPopup(new maplibregl.Popup().setText(p.label)).addTo(map);
      }
    });
    return () => map.remove();
  }, [q.data]);

  return (
    <>
      <PageHeader title="Mapa operativo" subtitle="Clientes, conexiones, lecturas y polilínea del recorrido de cobranza (violeta)." />
      <div ref={ref} className="h-[70vh] min-h-[320px] w-full overflow-hidden rounded-xl border border-slate-200" />
    </>
  );
}
