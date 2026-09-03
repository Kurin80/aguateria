import { describe, expect, it } from "vitest";
import { SifenProvider } from "./sifen-provider.js";

describe("SifenProvider", () => {
  it("nunca reporta aprobación si no está configurado", async () => {
    const p = new SifenProvider({
      enabled: false,
      environment: "test",
      host: "sifen-test.set.gov.py",
      certPresent: false,
      cscPresent: false,
      timeoutMs: 1000,
    });
    const r = await p.sendDe("<xml/>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SIFEN_NOT_CONFIGURED");
  });

  it("con flags activos pero sin transmisión real no finge APROBADO", async () => {
    const p = new SifenProvider({
      enabled: true,
      environment: "test",
      host: "sifen-test.set.gov.py",
      certPresent: true,
      cscPresent: true,
      timeoutMs: 1000,
    });
    const r = await p.sendDe("<xml/>");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SIFEN_UNAVAILABLE");
  });
});
