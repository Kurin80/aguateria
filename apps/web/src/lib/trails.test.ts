import { describe, expect, it } from "vitest";
import { trailsFromPoints } from "../lib/trails";

describe("polilínea de recorrido", () => {
  it("agrupa por ruta y ordena por tiempo", () => {
    const trails = trailsFromPoints([
      { lat: "-25.3", lng: "-57.6", routeId: "a", capturedAt: "2026-09-02T12:02:00.000Z" },
      { lat: "-25.31", lng: "-57.61", routeId: "a", capturedAt: "2026-09-02T12:01:00.000Z" },
      { lat: "-25.4", lng: "-57.7", routeId: "b", capturedAt: "2026-09-02T12:00:00.000Z" },
    ]);
    expect(trails).toHaveLength(1);
    expect(trails[0]?.[0]).toEqual([-57.61, -25.31]);
    expect(trails[0]?.[1]).toEqual([-57.6, -25.3]);
  });
});
