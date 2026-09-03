import { describe, expect, it } from "vitest";
import { nextBillStatus } from "./payments-apply.js";

describe("estado de boleta tras pago", () => {
  it("marca PAGADA si el saldo queda en cero", () => {
    expect(nextBillStatus({ total: 200000, balance: 0, dueOn: "2026-01-01", today: "2026-09-02", current: "EMITIDA" })).toBe("PAGADA");
  });

  it("marca PARCIAL si queda saldo", () => {
    expect(nextBillStatus({ total: 300000, balance: 150000, dueOn: "2026-01-01", today: "2026-09-02", current: "EMITIDA" })).toBe("PARCIAL");
  });

  it("marca VENCIDA si no hubo pago y ya venció", () => {
    expect(nextBillStatus({ total: 100000, balance: 100000, dueOn: "2026-01-01", today: "2026-09-02", current: "EMITIDA" })).toBe("VENCIDA");
  });

  it("tras restaurar el total vuelve a VENCIDA si la fecha ya pasó", () => {
    expect(nextBillStatus({ total: 200000, balance: 200000, dueOn: "2026-01-01", today: "2026-09-02", current: "PENDIENTE" })).toBe("VENCIDA");
  });
});
