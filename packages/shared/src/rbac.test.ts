import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "./rbac.js";

describe("RBAC simplificado", () => {
  it("no incluye permisos de rutas, órdenes ni mantenimiento", () => {
    expect(PERMISSIONS.some((p) => p.startsWith("rutas."))).toBe(false);
    expect(PERMISSIONS.some((p) => p.startsWith("ordenes."))).toBe(false);
    expect(PERMISSIONS.some((p) => p.startsWith("mantenimiento."))).toBe(false);
  });

  it("LECTOR no puede editar tarifas, facturación ni usuarios", () => {
    const lector = ROLE_PERMISSIONS.LECTOR;
    expect(lector).toContain("lecturas.crear");
    expect(lector.some((p) => p.startsWith("tarifas."))).toBe(false);
    expect(lector.some((p) => p.startsWith("facturas."))).toBe(false);
    expect(lector.some((p) => p.startsWith("usuarios."))).toBe(false);
    expect(lector.some((p) => p.startsWith("roles."))).toBe(false);
    expect(lector).not.toContain("configuracion.editar");
  });

  it("COBRADOR e INSTALADOR tienen permisos acotados", () => {
    expect(ROLE_PERMISSIONS.COBRADOR).toContain("pagos.crear");
    expect(ROLE_PERMISSIONS.COBRADOR).not.toContain("boletas.emitir");
    expect(ROLE_PERMISSIONS.INSTALADOR).toContain("instalaciones.registrar");
    expect(ROLE_PERMISSIONS.INSTALADOR).not.toContain("pagos.crear");
    expect(ROLE_PERMISSIONS.LECTORISTA).toEqual(ROLE_PERMISSIONS.LECTOR);
  });

  it("SUPERVISOR ve panel, padrón, lecturas, boletas y reportes", () => {
    const s = ROLE_PERMISSIONS.SUPERVISOR;
    for (const p of ["dashboard.ver", "clientes.ver", "conexiones.ver", "medidores.ver", "lecturas.ver", "boletas.ver", "reportes.ver"]) {
      expect(s).toContain(p);
    }
  });
});