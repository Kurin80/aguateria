import { describe, expect, it } from "vitest";
import { buildOperationalAlerts } from "./operational-alerts.js";

describe("alertas operativas", () => {
  it("omite ceros y respeta permisos", () => {
    const alerts = buildOperationalAlerts(
      { field_pending: 1, readings_anomalous: 2, delinquent: 2, bills_overdue: 0 },
      (p) => p === "lecturas.ver" || p === "lecturas.crear",
    );
    expect(alerts.map((a) => a.key)).toEqual(["field_pending", "anomalous"]);
    expect(alerts[0]?.message).toBe("1 lectura pendiente del período");
    expect(alerts[0]?.href).toBe("/campo");
    expect(alerts[1]?.message).toBe("2 lecturas con anomalía");
    expect(alerts[1]?.count).toBe(2);
  });
});
