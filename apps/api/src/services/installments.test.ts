import { describe, expect, it } from "vitest";
import { buildInstallmentSchedule } from "./installments.js";
import { formatCustomerCode } from "../lib/connection-code.js";

describe("cuotas de conexión", () => {
  it("reparte anticipo y cuotas", () => {
    const rows = buildInstallmentSchedule({
      total: 1_200_000,
      downPayment: 200_000,
      count: 5,
      firstDueOn: "2026-10-01",
    });
    expect(rows).toHaveLength(5);
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(1_000_000);
    expect(rows[0]?.dueOn).toBe("2026-10-01");
    expect(rows[1]?.dueOn).toBe("2026-11-01");
  });
});

describe("código de cliente", () => {
  it("genera CLI-000001", () => {
    expect(formatCustomerCode(1)).toBe("CLI-000001");
  });
});
