import { describe, expect, it } from "vitest";
import { isOperationalAlertDismissed } from "./notification-inbox.js";

describe("notificaciones leídas", () => {
  it("oculta una alerta operativa solo si el recuento no cambió", () => {
    const dismissals = [{ alertKey: "overdue", fingerprint: "3" }];
    expect(isOperationalAlertDismissed({ key: "overdue", count: 3 }, dismissals)).toBe(true);
    expect(isOperationalAlertDismissed({ key: "overdue", count: 4 }, dismissals)).toBe(false);
    expect(isOperationalAlertDismissed({ key: "install", count: 1 }, dismissals)).toBe(false);
  });
});
