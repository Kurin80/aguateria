const DEFAULT_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = "© OpenStreetMap contributors";

export const mapTileUrl = import.meta.env.VITE_MAP_TILE_URL || DEFAULT_TILE;
export const mapAttribution = import.meta.env.VITE_MAP_ATTRIBUTION || DEFAULT_ATTRIBUTION;

export function osmRasterStyle() {
  return {
    version: 8 as const,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: [mapTileUrl],
        tileSize: 256,
        attribution: mapAttribution,
      },
    },
    layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
  };
}
