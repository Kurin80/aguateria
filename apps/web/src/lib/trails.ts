export type TrailPoint = {
  lat?: string | number | null;
  lng?: string | number | null;
  longitude?: string | number | null;
  latitude?: string | number | null;
  routeId?: string;
  capturedAt?: string | null;
};

function lngLat(p: TrailPoint): [number, number] | null {
  const lat = Number(p.lat ?? p.latitude);
  const lng = Number(p.lng ?? p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lng, lat];
}

export function trailsFromPoints(points: TrailPoint[]): Array<Array<[number, number]>> {
  const groups = new Map<string, Array<[number, number]>>();
  const sorted = [...points].sort((a, b) => String(a.capturedAt ?? "").localeCompare(String(b.capturedAt ?? "")));
  for (const p of sorted) {
    const pair = lngLat(p);
    if (!pair) continue;
    const key = p.routeId ?? "default";
    const arr = groups.get(key) ?? [];
    arr.push(pair);
    groups.set(key, arr);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}
