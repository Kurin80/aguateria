import { describe, expect, it } from "vitest";
import { toSameOriginApiUrl, gpsBlockReason } from "./field-capture";

describe("subida de evidencia", () => {
  it("usa la ruta /api para no cruzar de origen (Vite :5173 → API :3001)", () => {
    expect(toSameOriginApiUrl("http://localhost:3001/api/files/abc/content?token=x")).toBe(
      "/api/files/abc/content?token=x",
    );
    expect(toSameOriginApiUrl("/api/files/abc/content?token=x")).toBe("/api/files/abc/content?token=x");
  });

  it("detecta cuando no hay GPS en este entorno", () => {
    expect(gpsBlockReason()).toBeTruthy();
  });
});
