import { describe, expect, it } from "vitest";
import { NAV, NAV_GROUPS, isFieldOnlyUser } from "./layout/nav";

describe("navegación", () => {
  it("incluye módulos operativos y fiscales por separado", () => {
    const labels = NAV.map((n) => n.label);
    const groups = NAV_GROUPS.map((g) => g.label);

    // Operativo
    expect(labels).toContain("Panel principal");
    expect(labels).toContain("Lectura de campo");
    expect(labels).toContain("Instalaciones");
    expect(labels).toContain("Cobranza y facturación");
    expect(labels).toContain("Boletas mes");
    expect(labels).toContain("Desconexiones");

    // Fiscal / facturación: grupo dedicado con sus módulos
    expect(groups).toContain("Facturación");
    const facturacion = NAV_GROUPS.find((g) => g.label === "Facturación");
    const facturacionLabels = facturacion?.items.map((i) => i.label) ?? [];
    expect(facturacionLabels).toContain("Tarifas");
    expect(facturacionLabels).toContain("Timbrados");
    expect(facturacionLabels).toContain("Morosidad");

    // Módulos que ya no existen en el padrón de navegación
    expect(labels).not.toContain("Rutas");
    expect(labels).not.toContain("Órdenes");
    expect(labels).not.toContain("Mantenimiento");
  });

  it("cada ítem de navegación declara permiso y destino", () => {
    for (const item of NAV) {
      expect(item.to.startsWith("/")).toBe(true);
      expect(item.permission.length).toBeGreaterThan(0);
    }
  });

  it("un LECTOR sin rol de oficina es usuario solo de campo", () => {
    expect(isFieldOnlyUser(["LECTOR"])).toBe(true);
    expect(isFieldOnlyUser(["LECTORISTA"])).toBe(true);
    expect(isFieldOnlyUser(["INSTALADOR"])).toBe(true);
    expect(isFieldOnlyUser(["COBRADOR"])).toBe(true);
    expect(isFieldOnlyUser(["LECTOR", "SUPERVISOR"])).toBe(false);
    expect(isFieldOnlyUser(["ADMINISTRADOR"])).toBe(false);
  });
});
