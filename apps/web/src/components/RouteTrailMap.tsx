import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { trailsFromPoints, type TrailPoint } from "../lib/trails";
import { osmRasterStyle } from "../lib/maps";

export function RouteTrailMap({
  points,
  markers,
  className,
}: {
  points: TrailPoint[];
  markers?: Array<{ lat: string | number | null; lng: string | number | null; color?: string; label?: string }>;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const trails = trailsFromPoints(points);
    const map = new maplibregl.Map({
      container: ref.current,
      style: osmRasterStyle(),
      center: trails[0]?.[0] ?? [-57.635, -25.3],
      zoom: trails[0] ? 14 : 11,
    });
    map.on("load", () => {
      trails.forEach((line, i) => {
        const id = `trail-${i}`;
        map.addSource(id, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: line },
          },
        });
        map.addLayer({
          id,
          type: "line",
          source: id,
          paint: { "line-color": "#7c3aed", "line-width": 4, "line-opacity": 0.85 },
        });
      });
      const last = trails[0]?.at(-1);
      if (last) {
        new maplibregl.Marker({ color: "#7c3aed" }).setLngLat(last).setPopup(new maplibregl.Popup().setText("Posición actual")).addTo(map);
      }
      for (const m of markers ?? []) {
        if (m.lat == null || m.lng == null) continue;
        new maplibregl.Marker({ color: m.color ?? "#0f4c5c" })
          .setLngLat([Number(m.lng), Number(m.lat)])
          .setPopup(new maplibregl.Popup().setText(m.label ?? ""))
          .addTo(map);
      }
    });
    return () => map.remove();
  }, [points, markers]);

  return <div ref={ref} className={className ?? "h-64 w-full overflow-hidden rounded-xl border border-slate-200"} />;
}
