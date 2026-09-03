import { describe, expect, it } from "vitest";
import { installmentCollectableUntil, isCollectableInstallment } from "./collectable-debts.js";

describe("cuotas cobrables", () => {
  it("en septiembre solo toma vencidas o del mes, no todo el plan", () => {
    const today = "2026-09-02";
    expect(installmentCollectableUntil(today)).toBe("2026-09-30");
    expect(isCollectableInstallment("2026-09-02", today)).toBe(true);
    expect(isCollectableInstallment("2026-08-01", today)).toBe(true);
    expect(isCollectableInstallment("2026-10-01", today)).toBe(false);
    expect(isCollectableInstallment("2026-12-02", today)).toBe(false);
  });

  it("a fin de mes incluye la cuota de los próximos 10 días", () => {
    const today = "2026-09-25";
    expect(installmentCollectableUntil(today)).toBe("2026-10-05");
    expect(isCollectableInstallment("2026-10-01", today)).toBe(true);
    expect(isCollectableInstallment("2026-10-06", today)).toBe(false);
  });
});
